      //  State
      let allRecords = [];
      let filtered   = [];
      let currentPage = 1;
      const PER_PAGE  = 15;


      //  Fetch History 
      async function loadHistory() {
        const token = Session.getToken();
        if (!token) {
          // Not logged in — redirect to login
          window.location.href = 'login.html';
          return;
        }
        try {
          const res = await fetch('/api/history', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.status === 401) {
            // Token expired or invalid
            Session.logout();
            window.location.href = 'login.html';
            return;
          }
          if (!res.ok) throw new Error('Failed to fetch');
          const data = await res.json();
          allRecords = data.records || [];
          updateStats();
          applyFilters();
          document.getElementById('headerSub').textContent =
            `${allRecords.length} scan${allRecords.length !== 1 ? 's' : ''} recorded`;
        } catch (e) {
          showError();
        }
      }

      function updateStats() {
        const total    = allRecords.length;
        const healthy  = allRecords.filter(r => (r.stage || '').toLowerCase() === 'healthy').length;
        const diseased = total - healthy;
        const avgConf  = total
          ? (allRecords.reduce((s, r) => s + (r.confidence || 0), 0) / total).toFixed(1)
          : 0;
        document.getElementById('statTotal').textContent    = total;
        document.getElementById('statHealthy').textContent  = healthy;
        document.getElementById('statDiseased').textContent = diseased;
        document.getElementById('statAvgConf').textContent  = avgConf + '%';
      }

      function applyFilters() {
        const search = document.getElementById('searchInput').value.toLowerCase();
        const stage  = document.getElementById('stageFilter').value;
        const sort   = document.getElementById('sortFilter').value;

        filtered = allRecords.filter(r => {
          const matchSearch = !search || (r.predicted_class || '').toLowerCase().includes(search);
          const matchStage  = !stage  || (r.stage || '') === stage;
          return matchSearch && matchStage;
        });

        if (sort === 'oldest')   filtered.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
        else if (sort === 'conf_desc') filtered.sort((a,b) => (b.confidence||0) - (a.confidence||0));
        else if (sort === 'sev_desc')  filtered.sort((a,b) => (b.severity_pct||0) - (a.severity_pct||0));
        else filtered.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

        currentPage = 1;
        document.getElementById('filterCount').textContent =
          filtered.length !== allRecords.length ? `${filtered.length} of ${allRecords.length}` : `${allRecords.length} records`;
        renderTable();
      }

      function renderTable() {
        const tbody = document.getElementById('historyTbody');
        const start = (currentPage - 1) * PER_PAGE;
        const page  = filtered.slice(start, start + PER_PAGE);

        if (!filtered.length) {
          tbody.innerHTML = `
            <tr><td colspan="8">
              <div class="empty-state">
                <div class="empty-icon">
                  <i data-lucide="inbox" style="width:32px;height:32px;color:var(--leaf)"></i>
                </div>
                <h3>No scans found</h3>
                <p>Try adjusting your filters or scan a plant first.</p>
                <a href="detect.html" class="btn-primary">
                  <i data-lucide="scan-line" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>
                  Scan a Plant
                </a>
              </div>
            </td></tr>`;
          lucide.createIcons();
          document.getElementById('pagination').style.display = 'none';
          return;
        }

        tbody.innerHTML = page.map((r, i) => {
          const idx       = start + i + 1;
          const stage     = r.stage || 'Unknown';
          const stageClass = `stage-${stage.toLowerCase()}`;
          const sevPct    = r.severity_pct || 0;
          const conf      = r.confidence || 0;
          const confClass = conf >= 75 ? '' : (conf >= 50 ? 'medium' : 'low');
          const sevClass  = sevPct < 25 ? 'sev-low' : (sevPct < 60 ? 'sev-medium' : 'sev-high');
          const dotColor  = stage === 'Healthy' ? 'var(--leaf)' : (sevPct < 50 ? 'var(--amber)' : 'var(--red)');
          const dateStr   = r.created_at
            ? new Date(r.created_at).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
            : '—';

          return `
            <tr>
              <td style="color:var(--text-soft);font-size:12px;font-weight:700;">${idx}</td>
              <td>
                <div class="disease-cell">
                  <div class="disease-dot" style="background:${dotColor}"></div>
                  <span class="disease-name">${r.predicted_class || '—'}</span>
                </div>
              </td>
              <td>
                <div class="conf-bar-wrap">
                  <span style="font-size:13px;font-weight:800;color:var(--text);">${conf}%</span>
                  <div class="conf-bar">
                    <div class="conf-bar-fill ${confClass}" style="width:${conf}%"></div>
                  </div>
                </div>
              </td>
              <td class="severity-cell">
                <span class="severity-val ${sevClass}">${sevPct}%</span>
              </td>
              <td>
                <span class="stage-badge ${stageClass}">${stage}</span>
              </td>
              <td style="font-size:12px;font-weight:600;color:var(--text-mid);max-width:180px;">${r.urgency || '—'}</td>
              <td class="date-cell">${dateStr}</td>
              <td>
                <div class="row-actions">
                  <button class="btn-icon" title="View Details" onclick='showDetail(${JSON.stringify(r)})'>
                    <i data-lucide="eye" style="width:14px;height:14px;"></i>
                  </button>
                </div>
              </td>
            </tr>`;
        }).join('');

        lucide.createIcons();
        renderPagination();
      }

      function renderPagination() {
        const total = Math.ceil(filtered.length / PER_PAGE);
        const pg    = document.getElementById('pagination');
        if (total <= 1) { pg.style.display = 'none'; return; }
        pg.style.display = 'flex';

        const start = (currentPage - 1) * PER_PAGE + 1;
        const end   = Math.min(currentPage * PER_PAGE, filtered.length);

        let btns = '';
        for (let p = 1; p <= total; p++) {
          if (total > 7 && p > 2 && p < total - 1 && Math.abs(p - currentPage) > 1) {
            if (p === 3 || p === total - 2) btns += `<button class="page-btn" disabled>…</button>`;
            continue;
          }
          btns += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
        }

        pg.innerHTML = `
          <span class="page-info">Showing ${start}–${end} of ${filtered.length}</span>
          <div class="page-btns">
            <button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>
              <i data-lucide="chevron-left" style="width:14px;height:14px;"></i>
            </button>
            ${btns}
            <button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===total?'disabled':''}>
              <i data-lucide="chevron-right" style="width:14px;height:14px;"></i>
            </button>
          </div>`;
        lucide.createIcons();
      }

      function goPage(p) {
        const total = Math.ceil(filtered.length / PER_PAGE);
        if (p < 1 || p > total) return;
        currentPage = p;
        renderTable();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // ── Modal ──
      function showDetail(r) {
        const dateStr = r.created_at
          ? new Date(r.created_at).toLocaleString('en-IN')
          : '—';
        document.getElementById('modalBody').innerHTML = `
          <div class="modal-row"><span class="modal-label">Disease</span><span class="modal-value">${r.predicted_class || '—'}</span></div>
          <div class="modal-row"><span class="modal-label">Confidence</span><span class="modal-value">${r.confidence || 0}%</span></div>
          <div class="modal-row"><span class="modal-label">Severity</span><span class="modal-value">${r.severity_pct || 0}%</span></div>
          <div class="modal-row"><span class="modal-label">Stage</span><span class="modal-value">${r.stage || '—'}</span></div>
          <div class="modal-row"><span class="modal-label">Urgency</span><span class="modal-value">${r.urgency || '—'}</span></div>
          <div class="modal-row"><span class="modal-label">Scanned At</span><span class="modal-value">${dateStr}</span></div>
        `;
        document.getElementById('detailModal').classList.add('open');
        lucide.createIcons();
      }

      function closeModal(e) {
        if (e.target === document.getElementById('detailModal'))
          document.getElementById('detailModal').classList.remove('open');
      }

      // ── Export CSV ──
      function exportCSV() {
        if (!filtered.length) return;
        const headers = ['#', 'Disease', 'Confidence(%)', 'Severity(%)', 'Stage', 'Urgency', 'Date'];
        const rows = filtered.map((r, i) => [
          i + 1,
          `"${(r.predicted_class||'').replace(/"/g,'""')}"`,
          r.confidence || 0,
          r.severity_pct || 0,
          r.stage || '',
          `"${(r.urgency||'').replace(/"/g,'""')}"`,
          r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : ''
        ]);
        const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
        const a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
        a.download = `LeafSense_History_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
      }

      function showError() {
        document.getElementById('historyTbody').innerHTML = `
          <tr><td colspan="8">
            <div class="empty-state">
              <div class="empty-icon" style="background:var(--red-pale)">
                <i data-lucide="wifi-off" style="width:32px;height:32px;color:var(--red)"></i>
              </div>
              <h3>Could not load history</h3>
              <p>Make sure the server is running and you are logged in.</p>
              <button class="btn-primary" onclick="loadHistory()">Retry</button>
            </div>
          </td></tr>`;
        lucide.createIcons();
        document.getElementById('headerSub').textContent = 'Failed to load scans';
      }

      loadHistory();