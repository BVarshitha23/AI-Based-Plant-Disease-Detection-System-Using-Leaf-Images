import psycopg2
from psycopg2.extras import RealDictCursor
from Config import DB_CONFIG


def get_db() -> psycopg2.extensions.connection:
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)


def init_db() -> None:
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         SERIAL PRIMARY KEY,
                username   VARCHAR(50)  UNIQUE NOT NULL,
                email      VARCHAR(255) UNIQUE NOT NULL,
                password   VARCHAR(255) NOT NULL,
                is_admin   BOOLEAN      DEFAULT FALSE,
                created_at TIMESTAMPTZ  DEFAULT NOW()
            );
        """)
        cur.execute("""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS predictions (
                id              SERIAL PRIMARY KEY,
                user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
                predicted_class VARCHAR(255) NOT NULL,
                confidence      FLOAT        NOT NULL,
                severity_pct    FLOAT        NOT NULL,
                stage           VARCHAR(50)  NOT NULL,
                urgency         TEXT         NOT NULL,
                created_at      TIMESTAMPTZ  DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id         SERIAL PRIMARY KEY,
                user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
                rating     SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
                category   VARCHAR(50)  NOT NULL,
                message    TEXT,
                is_farmer  BOOLEAN      DEFAULT FALSE,
                created_at TIMESTAMPTZ  DEFAULT NOW()
            );
        """)
        conn.commit()
        print("  DB tables ready")
    finally:
        cur.close()
        conn.close()