let camStream    = null;   // active MediaStream
let facingMode   = 'environment'; // 'environment' = rear, 'user' = front

//  Open Camera
async function openCamera() {
  const overlay = document.getElementById('camOverlay');
  const video   = document.getElementById('camVideo');

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';

  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facingMode,
        width:  { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = camStream;
    await video.play();

    // Show flip button only if device has multiple cameras
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    document.getElementById('camSwitchBtn').style.display =
      cameras.length > 1 ? 'inline-flex' : 'none';

  } catch (err) {
    closeCamera();
    let msg = 'Camera access denied.';
    if (err.name === 'NotFoundError')     msg = 'No camera found on this device.';
    if (err.name === 'NotAllowedError')   msg = 'Camera permission denied. Please allow camera access in your browser settings.';
    if (err.name === 'NotReadableError')  msg = 'Camera is already in use by another app.';
    showCamError(msg);
  }
}

// Close Camera
function closeCamera() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  const video = document.getElementById('camVideo');
  video.srcObject = null;
  document.getElementById('camOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

//  Flip Camera (front ↔ rear) 
async function switchCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';

  // Stop current stream
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }

  const video = document.getElementById('camVideo');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = camStream;
    await video.play();
  } catch (err) {
    showCamError('Could not switch camera.');
  }
}

// Capture Photo 
function capturePhoto() {
  const video  = document.getElementById('camVideo');
  const canvas = document.getElementById('camCanvas');

  // Draw current video frame onto canvas
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');

  // Mirror front camera so image isn't flipped
  if (facingMode === 'user') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Convert canvas to Blob → File → preview
  canvas.toBlob(blob => {
    const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
    selectedFile = file;                       // set global selectedFile in detect.js
    showPreview(URL.createObjectURL(blob));    // show preview in drop zone
    closeCamera();
  }, 'image/jpeg', 0.92);
}

//  Error Toast 
function showCamError(msg) {
  const toast = document.createElement('div');
  toast.className = 'cam-error-toast';
  toast.innerHTML = `
    <i data-lucide="alert-circle" style="width:16px;height:16px;flex-shrink:0;"></i>
    <span>${msg}</span>
  `;
  document.body.appendChild(toast);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  setTimeout(() => toast.remove(), 4000);
}

//  Close on overlay click (outside modal) 
document.getElementById('camOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeCamera();
});