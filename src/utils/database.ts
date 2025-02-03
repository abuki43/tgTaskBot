import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./bot.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);  // Exit if we can't open the database
    }
    console.log('Connected to the SQLite database');
});

db.serialize(() => {
    try {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT UNIQUE,
            phone_number TEXT,
            points INTEGER DEFAULT 0,
            is_registered BOOLEAN DEFAULT 0,
            payment_method TEXT,
            payment_detail TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            referral_points INTEGER DEFAULT 0
        )`);

        // Tasks table
        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            video_url TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // User completed tasks with daily limit
        db.run(`CREATE TABLE IF NOT EXISTS completed_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            task_id INTEGER,
            completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            date_completed DATE GENERATED ALWAYS AS (DATE(completed_at)) STORED,
            UNIQUE(user_id, task_id, date_completed)
        )`);

        // Withdrawal requests with more status options
        db.run(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            points INTEGER,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            processed_at DATETIME
        )`);

        // Insert demo tasks if they don't exist
        db.get(`SELECT COUNT(*) as count FROM tasks`, [], (err, row: any) => {
            if (row.count === 0) {
                const demoTasks = [
                    { video_url: 'https://youtube.com/watch?v=1', title: 'Watch Demo Video 1' },
                    { video_url: 'https://youtube.com/watch?v=2', title: 'Watch Demo Video 2' },
                    { video_url: 'https://youtube.com/watch?v=3', title: 'Watch Demo Video 3' }
                ];
                demoTasks.forEach(task => {
                    db.run(`INSERT INTO tasks (video_url, title) VALUES (?, ?)`, [task.video_url, task.title]);
                });
            }
        });

        // Add referrals table
        db.run(`CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id TEXT NOT NULL,
            referred_id TEXT NOT NULL,
            points_earned INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(referred_id)
        )`);

       
    } catch (err) {
        console.error('Error during database initialization:', err);
        process.exit(1);
    }
});

// Add error handler for the database connection
db.on('error', (err) => {
    console.error('Database error:', err);
});

// Add these helper functions for referrals
export async function addReferral(referrerId: string, referredId: string): Promise<boolean> {
    return new Promise((resolve) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            try {
                // Check if the referred user is already registered
                db.get(
                    'SELECT telegram_id FROM users WHERE telegram_id = ?',
                    [referredId],
                    (err, row) => {
                        if (row) {
                            db.run('ROLLBACK');
                            resolve(false);
                            return;
                        }

                        // Add referral record
                        db.run(
                            'INSERT OR IGNORE INTO referrals (referrer_id, referred_id) VALUES (?, ?)',
                            [referrerId, referredId],
                            (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    resolve(false);
                                    return;
                                }

                                // Update referrer's points
                                db.run(
                                    'UPDATE users SET referral_points = referral_points + 50, points = points + 50 WHERE telegram_id = ?',
                                    [referrerId],
                                    (err) => {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            resolve(false);
                                            return;
                                        }

                                        db.run('COMMIT');
                                        resolve(true);
                                    }
                                );
                            }
                        );
                    }
                );
            } catch (error) {
                db.run('ROLLBACK');
                resolve(false);
            }
        });
    });
}

export async function getReferralStats(userId: string): Promise<any> {
    return new Promise((resolve) => {
        db.get(
            `SELECT 
                (SELECT COUNT(*) FROM referrals WHERE referrer_id = ?) as total_referrals,
                (SELECT COALESCE(SUM(points_earned), 0) FROM referrals WHERE referrer_id = ?) as total_points_earned,
                (SELECT referrer_id FROM referrals WHERE referred_id = ?) as referred_by,
                (SELECT referral_points FROM users WHERE telegram_id = ?) as referral_points
            `,
            [userId, userId, userId, userId],
            (err, row) => {
                if (err) {
                    resolve(null);
                    return;
                }
                resolve(row);
            }
        );
    });
}

export default db; 