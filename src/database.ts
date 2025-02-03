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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    } catch (err) {
        console.error('Error during database initialization:', err);
        process.exit(1);
    }
});

// Add error handler for the database connection
db.on('error', (err) => {
    console.error('Database error:', err);
});

export default db; 