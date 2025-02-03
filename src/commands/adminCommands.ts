import TelegramBot from 'node-telegram-bot-api';
import db from '../utils/database';
import { checkUserMembership } from '../utils/membership';




export async function handleBroadcast(msg: any, adminChatId: string, adminBot:TelegramBot, bot:TelegramBot) {
    if (msg.chat.id.toString() !== adminChatId) return;
    
    adminBot.sendMessage(msg.chat.id, 'Please enter the message you want to broadcast:');
    adminBot.once('message', async (broadcastMsg) => {
        if (!broadcastMsg.text) return;
        
        db.all(`SELECT telegram_id FROM users WHERE is_registered = 1`, [], async (err, users: {telegram_id: string}[]) => {
            if (err) {
                adminBot.sendMessage(msg.chat.id, 'Error fetching users.');
                return;
            }
            
            let successCount = 0;
            let failCount = 0;
            
            for (const user of users) {
                try {
                    await bot.sendMessage(user.telegram_id, broadcastMsg.text!);
                    successCount++;
                } catch {
                    failCount++;
                }
            }
            
            adminBot.sendMessage(msg.chat.id, 
                `Broadcast completed!\nSuccess: ${successCount}\nFailed: ${failCount}`);
        });
    });
}

export async function handleAddTask(msg: TelegramBot.Message, adminChatId: string, adminBot: TelegramBot) {
    if (msg.chat.id.toString() !== adminChatId) return;
    
    adminBot.sendMessage(msg.chat.id, 
        'Please enter task details in the following format:\n' +
        'Title | Video URL | Points\n\n' +
        'Example:\nWatch this video | https://youtube.com/watch?v=123 | 50');
    
    adminBot.once('message', (taskMsg) => {
        if (!taskMsg.text) return;
        
        const [title, video_url, points] = taskMsg.text.split('|').map(s => s.trim());
        const pointsValue = parseInt(points) || 20; // Default to 20 if not specified
        
        if (!title || !video_url) {
            adminBot.sendMessage(msg.chat.id, '❌ Invalid format. Please try again.');
            return;
        }

        // Validate URL format
        try {
            new URL(video_url);
        } catch {
            adminBot.sendMessage(msg.chat.id, '❌ Invalid video URL. Please try again.');
            return;
        }
        
        if (title.length < 3 || title.length > 100) {
            adminBot.sendMessage(msg.chat.id, '❌ Title must be between 3 and 100 characters.');
            return;
        }

        if (pointsValue < 1 || pointsValue > 1000) {
            adminBot.sendMessage(msg.chat.id, '❌ Points must be between 1 and 1000.');
            return;
        }
        
        db.run(`INSERT INTO tasks (title, video_url, points) VALUES (?, ?, ?)`,
            [title, video_url, pointsValue], (err) => {
            if (err) {
                adminBot.sendMessage(msg.chat.id, `❌ Error adding task.: ${err?.message}`);
                return;
            }
            adminBot.sendMessage(msg.chat.id, 
                '✅ Task added successfully!\n\n' +
                `📝 Title: ${title}\n` +
                `🎥 URL: ${video_url}\n` +
                `💰 Points: ${pointsValue}`
            );
        });
    });
}

export async function handleDeleteTask(msg: any, adminChatId: string,adminBot:TelegramBot) {
    if (msg.chat.id.toString() !== adminChatId) return;
    
    db.all(`SELECT id, title FROM tasks`, [], (err, tasks: any[]) => {
        if (err || !tasks.length) {
            adminBot.sendMessage(msg.chat.id, 'No tasks available.');
            return;
        }
        
        const keyboard = tasks.map(task => [{
            text: task.title,
            callback_data: `delete_${task.id}`
        }]);
        
        adminBot.sendMessage(msg.chat.id, 'Select task to delete:', {
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    });
}



export async function handleStats(msg:any,adminChatId:string, adminBot:TelegramBot){
    if (msg.chat.id.toString() !== adminChatId) return;
    
    db.get(`
        SELECT 
            COUNT(*) as total_users,
            SUM(CASE WHEN is_registered = 1 THEN 1 ELSE 0 END) as registered_users,
            SUM(points) as total_points
        FROM users
    `, [], (err, stats: any) => {
        if (err) {
            adminBot.sendMessage(msg.chat.id, 'Error fetching statistics.');
            return;
        }
        
        adminBot.sendMessage(msg.chat.id, 
            `📊 Bot Statistics\n\n` +
            `Total Users: ${stats.total_users}\n` +
            `Registered Users: ${stats.registered_users}\n` +
            `Total Points Distributed: ${stats.total_points}`
        );
    });
}

export async function handleViewTasks(msg:any, adminChatId:string, adminBot:TelegramBot){
    if (msg.chat.id.toString() !== adminChatId) return;
    
    db.all(`SELECT * FROM tasks`, [], (err, tasks: any[]) => {
        if (err || !tasks.length) {
            adminBot.sendMessage(msg.chat.id, 'No tasks available.');
            return;
        }
        
        const tasksList = tasks.map(task => 
            `ID: ${task.id}\nTitle: ${task.title}\nVideo: ${task.video_url}\n`
        ).join('\n');
        
        adminBot.sendMessage(msg.chat.id, `📝 Available Tasks:\n\n${tasksList}`);
    });
}


