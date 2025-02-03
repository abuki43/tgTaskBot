require('dotenv').config()
import TelegramBot from 'node-telegram-bot-api';
import db from './database';
// import { getDailyTasks, completeTask } from './tasks';

const token = process.env.BOT_TOKEN as string;
const adminBotToken = process.env.ADMIN_BOT_TOKEN as string;
const adminChatId = process.env.ADMIN_CHAT_ID as string;

const bot = new TelegramBot(token, { polling: true });
const adminBot = new TelegramBot(adminBotToken, { polling: true });

// Track video watching status
const watchingUsers = new Map<number, { taskId: number, startTime: number }>();
interface Task {
    id: number;
    title: string;
    video_url: string;
} 
// Available commands for users
const userCommands = [
    { command: 'start', description: 'Start the bot and register' },
    { command: 'daily', description: 'Get daily tasks' },
    { command: 'balance', description: 'Check your points balance' },
    { command: 'withdraw', description: 'Request withdrawal' },
    { command: 'help', description: 'Show available commands' },
    { command: 'settings', description: '⚙️ Configure payment settings' }
];

// Available commands for admin
const adminCommands = [
    { command: 'broadcast', description: 'Send message to all users' },
    { command: 'stats', description: 'View total users and statistics' },
    { command: 'addtask', description: 'Add new task' },
    { command: 'deletetask', description: 'Delete existing task' },
    { command: 'tasks', description: 'View all tasks' }
];

// Set commands for both bots
bot.setMyCommands(userCommands);
adminBot.setMyCommands(adminCommands);

console.log('Bot is running');

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    // Check if user is already registered
    db.get(`SELECT is_registered FROM users WHERE telegram_id = ?`, [chatId], (err, row: any) => {
        if (row && row.is_registered) {
            bot.sendMessage(chatId, 
                '🎉 *Welcome Back!*\n\n' +
                '✨ You are already registered!\n' +
                '📝 Use /help to see available commands.', {
                parse_mode: 'Markdown',
                reply_markup: {
                    remove_keyboard: true
                }
            });
        } else {
            bot.sendMessage(chatId, 'Welcome to the bot! Please share your phone number to register.', {
                reply_markup: {
                    keyboard: [[
                        {
                            text: 'Share Phone Number',
                            request_contact: true
                        }
                    ]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });
        }
    });
});

bot.on('contact', (msg) => {
    const chatId = msg.chat.id;

    if (msg.contact) {
        const phoneNumber = msg.contact.phone_number;

        db.run(`INSERT OR IGNORE INTO users (telegram_id, phone_number, is_registered) VALUES (?, ?, 1)`, 
            [chatId, phoneNumber], (err) => {
            if (err) {
                bot.sendMessage(chatId, 'Error registering user.');
            } else {
                bot.sendMessage(chatId, 'Thank you! You are registered. Use /help to see available commands.', {
                    reply_markup: {
                        remove_keyboard: true
                    }
                });
            }
        });
    }
});

bot.onText(/\/balance/, (msg) => {
    const chatId = msg.chat.id;
    db.get(`SELECT points FROM users WHERE telegram_id = ?`, [chatId], (err, row: any) => {
        if (row) {
            bot.sendMessage(chatId, `Your current balance is: ${row.points} points`);
        } else {
            bot.sendMessage(chatId, 'Please register first using /start');
        }
    });
});

bot.onText(/\/withdraw/, (msg) => {
    const chatId = msg.chat.id;
    db.get(`SELECT points, payment_method, payment_detail FROM users WHERE telegram_id = ?`, 
        [chatId], (err, row: any) => {
        if (!row.payment_method || !row.payment_detail) {
            bot.sendMessage(chatId, 
                '⚠️ Please set up your payment details first!\n' +
                'Use /settings to configure your payment method.');
            return;
        }

        if (row && row.points >= 30) {
            bot.sendMessage(chatId, 
                '💰 *Withdrawal Request*\n\n' +
                `Current Balance: ${row.points} points\n` +
                'Please enter the amount of points you want to withdraw:\n' +
                '_(Minimum: 30 points)_', {
                parse_mode: 'Markdown'
            });

            bot.once('message', async (pointsMsg) => {
                const pointsToWithdraw = parseInt(pointsMsg.text || '0', 10);
                
                if (isNaN(pointsToWithdraw) || pointsToWithdraw < 30) {
                    bot.sendMessage(chatId, '❌ Minimum withdrawal amount is 30 points.');
                    return;
                }
                
                if (pointsToWithdraw > row.points) {
                    bot.sendMessage(chatId, `❌ You only have ${row.points} points available.`);
                    return;
                }

                db.run(`INSERT INTO withdrawal_requests (user_id, points) VALUES (?, ?)`, 
                    [chatId, pointsToWithdraw], (err) => {
                    if (!err) {
                        bot.sendMessage(chatId, '✅ Your withdrawal request has been sent to admin for approval.');
                        // Notify admin
                        adminBot.sendMessage(adminChatId, 
                            `🆕 *New Withdrawal Request*\n\n` +
                            `👤 User ID: ${chatId}\n` +
                            `💰 Requested: ${pointsToWithdraw} points\n` +
                            `💳 Current Balance: ${row.points} points\n` +
                            `\n*Payment Details:*\n` +
                            `Method: ${row.payment_method.toUpperCase()}\n` +
                            `Details: \`${row.payment_detail}\``, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ Accept', callback_data: `accept_${chatId}` },
                                    { text: '❌ Reject', callback_data: `reject_${chatId}` }
                                ]]
                            }
                        });
                    }
                });
            });
        } else {
            bot.sendMessage(chatId, '❌ You need at least 30 points to withdraw.');
        }
    });
});

// Admin bot handlers
adminBot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;

    if (msg && data) {
        const [action, userId] = data.split('_');
        if (action === 'accept') {
            adminBot.sendMessage(msg.chat.id, 'Enter points to withdraw (e.g., "20"):');
            // Store the context for the next message
            adminBot.once('message', async (pointsMsg) => {
                const pointsToWithdraw = parseInt(pointsMsg.text || '0', 10);
                db.run(`UPDATE users SET points = points - ? WHERE telegram_id = ?`, 
                    [pointsToWithdraw, userId], (err) => {
                    if (!err) {
                        bot.sendMessage(userId, `Your withdrawal of ${pointsToWithdraw} points has been approved!`);
                        adminBot.sendMessage(msg.chat.id, 'Withdrawal processed successfully.');
                    }
                });
            });
        } else if (action === 'reject') {
            db.run(`UPDATE withdrawal_requests SET status = 'rejected' WHERE user_id = ?`, 
                [userId], (err) => {
                if (!err) {
                    bot.sendMessage(userId, 'Your withdrawal request has been rejected.');
                    adminBot.sendMessage(msg.chat.id, 'Withdrawal request rejected.');
                }
            });
        }
    }
});

// Help command
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = '🤖 *Available Commands:*\n\n' + userCommands
        .map(cmd => `/${cmd.command} - ${cmd.description}`)
        .join('\n');
    
    bot.sendMessage(chatId, 
        helpText + '\n\n' +
        '💡 *Tips:*\n' +
        '• Complete daily tasks to earn points\n' +
        '• Watch videos fully to get rewards\n' +
        '• Withdraw when you reach 30 points', {
        parse_mode: 'Markdown'
    });
});

// Updated daily tasks implementation
bot.onText(/\/daily/, (msg) => {
    const chatId = msg.chat.id;
    db.all(`
        SELECT t.* FROM tasks t
        WHERE NOT EXISTS (
            SELECT 1 FROM completed_tasks ct 
            WHERE ct.task_id = t.id 
            AND ct.user_id = ? 
            AND DATE(ct.completed_at) = DATE('now')
        )
        LIMIT 5
    `, [chatId], (err, tasks: Task[]) => {
        if (err || tasks.length === 0) {
            bot.sendMessage(chatId, 
                '📺 *No More Tasks*\n\n' +
                '✨ You\'ve completed all tasks for today!\n' +
                '🌟 Come back tomorrow for more.', {
                parse_mode: 'Markdown'
            });
            return;
        }

        bot.sendMessage(chatId, 
            '📋 *Daily Tasks Available*\n\n' +
            '💫 Complete these tasks to earn points!\n' +
            '⏱ Each task requires 20 seconds of watching\n' +
            '🎯 Earn 20 points per completed task', {
            parse_mode: 'Markdown'
        });

        tasks.forEach((task) => {
            bot.sendMessage(chatId, 
                `📝 *Task:* ${task.title}\n\n` +
                `ℹ️ *Instructions:*\n` +
                `1️⃣ Click "Watch Video" to start\n` +
                `2️⃣ Watch for at least 20 seconds\n` +
                `3️⃣ Click "Finish Task" to earn points`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '▶️ Watch Video', callback_data: `watch_${task.id}` },
                        { text: '✅ Finish Task', callback_data: `finish_${task.id}` }
                    ]]
                }
            });
        });
    });
});

// Handle video watching callbacks
bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    if (!msg || !data) return;

    const userId = msg.chat.id;
    
    if (data.startsWith('watch_')) {
        const taskId = data.split('_')[1];
        const taskIdNum = parseInt(taskId, 10);
        
        // Get video URL from database
        db.get(`SELECT video_url FROM tasks WHERE id = ?`, [taskIdNum], (err, task: any) => {
            if (err || !task) {
                bot.answerCallbackQuery(callbackQuery.id, { 
                    text: '❌ Error loading video'
                });
                return;
            }

            // Start watching
            watchingUsers.set(userId, { taskId: taskIdNum, startTime: Date.now() });
            
            bot.answerCallbackQuery(callbackQuery.id, { 
                text: `🎥 Video Started\n\n` +
                      `🔗 Watch here: ${task.video_url}\n\n` +
                      `⏱ Watch for at least 20 seconds\n` +
                      `✅ Click "Finish Task" when done`
            });
            
            // Send the video URL as a separate message
            bot.sendMessage(userId, `🎥 Watch video here: ${task.video_url}`);
        });
    }
    
    else if (data.startsWith('finish_')) {
        const taskId = data.split('_')[1];
        const taskIdNum = parseInt(taskId, 10);
        const watchingData = watchingUsers.get(userId);
        
        // Check if user has started watching
        if (!watchingData || watchingData.taskId !== taskIdNum) {
            bot.answerCallbackQuery(callbackQuery.id, { 
                text: '⚠️ Please watch the video first!',
                show_alert: true
            });
            return;
        }

        // Check if enough time has passed
        const timeSpent = (Date.now() - watchingData.startTime) / 1000;
        if (timeSpent < 20) {
            bot.answerCallbackQuery(callbackQuery.id, { 
                text: `⏳ watch the video and wait ${Math.ceil(20 - timeSpent)} more seconds`,
                show_alert: true
            });
            return;
        }

        // Complete the task
        db.run(`INSERT INTO completed_tasks (user_id, task_id, completed_at) VALUES (?, ?, datetime('now'))`, 
            [userId, taskIdNum], (err) => {
            if (!err) {
                db.run(`UPDATE users SET points = points + 20 WHERE telegram_id = ?`, 
                    [userId], (err) => {
                    if (!err) {
                        bot.editMessageReplyMarkup({
                            inline_keyboard: [[
                                { text: '✅ Task Completed', callback_data: 'completed' }
                            ]]
                        }, {
                            chat_id: msg.chat.id,
                            message_id: msg.message_id
                        });
                        bot.sendMessage(msg.chat.id, 
                            '🎉 *Task Completed!*\n\n' +
                            '🎯 You earned 20 points!\n' +
                            '💰 Use /balance to check your earnings\n' +
                            '📝 Use /daily for more tasks', {
                            parse_mode: 'Markdown'
                        });
                        watchingUsers.delete(userId);
                        bot.answerCallbackQuery(callbackQuery.id, { 
                            text: '✅ Task completed successfully!'
                        });
                    }
                });
            } else {
                bot.sendMessage(msg.chat.id, '❌ You have already completed this task today.');
                bot.answerCallbackQuery(callbackQuery.id, { 
                    text: '❌ Task already completed'
                });
            }
        });
    }
})

// Admin Commands
adminBot.onText(/\/broadcast/, (msg) => {
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
});

adminBot.onText(/\/stats/, (msg) => {
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
});

adminBot.onText(/\/addtask/, (msg) => {
    if (msg.chat.id.toString() !== adminChatId) return;
    
    adminBot.sendMessage(msg.chat.id, 
        'Please enter task details in the following format:\n' +
        'Title | Video URL\n\n' +
        'Example:\nWatch this video | https://youtube.com/watch?v=123'
    );
    
    adminBot.once('message', (taskMsg) => {
        if (!taskMsg.text) return;
        
        const [title, video_url] = taskMsg.text.split('|').map(s => s.trim());
        
        if (!title || !video_url) {
            adminBot.sendMessage(msg.chat.id, 'Invalid format. Please try again.');
            return;
        }

        // Validate URL format
        try {
            new URL(video_url);
        } catch {
            adminBot.sendMessage(msg.chat.id, 'Invalid video URL. Please try again.');
            return;
        }
        
        if (title.length < 3 || title.length > 100) {
            adminBot.sendMessage(msg.chat.id, 'Title must be between 3 and 100 characters.');
            return;
        }
        
        db.run(`INSERT INTO tasks (title, video_url) VALUES (?, ?)`,
            [title, video_url], (err) => {
            if (err) {
                adminBot.sendMessage(msg.chat.id, 'Error adding task.');
                return;
            }
            adminBot.sendMessage(msg.chat.id, 'Task added successfully!');
        });
    });
});

adminBot.onText(/\/deletetask/, (msg) => {
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
});

adminBot.onText(/\/tasks/, (msg) => {
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
});

// Handle admin task deletion
adminBot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    
    if (!msg || !data || msg.chat.id.toString() !== adminChatId) return;
    
    if (data.startsWith('delete_')) {
        const taskId = parseInt(data.split('_')[1], 10);
        
        db.run(`DELETE FROM tasks WHERE id = ?`, [taskId], (err) => {
            if (err) {
                adminBot.sendMessage(msg.chat.id, 'Error deleting task.');
                return;
            }
            adminBot.editMessageText('Task deleted successfully!', {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            });
        });
    }
});

// Add payment settings handler
bot.onText(/\/settings/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        '⚙️ *Payment Settings*\n\n' +
        'Choose payment method:\n' +
        '🏦 Available options:\n' +
        '• CBE Bank\n' +
        '• TeleBirr\n\n' +
        'Select your preferred method:', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: 'CBE Bank 🏦', callback_data: 'set_cbe' },
                { text: 'TeleBirr ��', callback_data: 'set_telbirr' }
            ]]
        }
    });
});

// Handle payment settings
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    if (!msg || !data) return;

    if (data.startsWith('set_')) {
        const method = data.split('_')[1];
        const chatId = msg.chat.id;
        
        bot.sendMessage(chatId, 
            `📝 Please enter your ${method === 'cbe' ? 'CBE Bank account number' : 'TeleBirr phone number'}:`);
        
        bot.once('message', async (detailMsg) => {
            if (!detailMsg.text) return;
            
            db.run(`UPDATE users SET payment_method = ?, payment_detail = ? WHERE telegram_id = ?`,
                [method, detailMsg.text, chatId], (err) => {
                if (!err) {
                    bot.sendMessage(chatId, '✅ Payment details updated successfully!');
                } else {
                    bot.sendMessage(chatId, '❌ Error updating payment details. Please try again.');
                }
            });
        });
    }
});


