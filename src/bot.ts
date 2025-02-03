require('dotenv').config()
import TelegramBot from 'node-telegram-bot-api';
import db from './utils/database';
import { handleViewTasks, handleStats, handleDeleteTask, handleAddTask, handleBroadcast } from "./commands/adminCommands"
import { handleDaily, handleBalance, handleSettings, handleWithdraw, handleHelp, handleContact,handleReferrals,handleStart } from "./commands/userCommands"

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
//  commands for users
const userCommands = [
    { command: 'start', description: '🚀 Start the bot and begin your journey' },
    { command: 'daily', description: '📅 Get your daily tasks and rewards' },
    { command: 'balance', description: '💰 Check your points balance' },
    { command: 'withdraw', description: '💳 Request withdrawal of earnings' },
    { command: 'help', description: '❓ Show all available commands' },
    { command: 'settings', description: '⚙️ Configure payment settings' },
    { command: 'referrals', description: '👥 View your referral stats & earn more' }
];

//  commands for admin
const adminCommands = [
    { command: 'broadcast', description: '📢 Send message to all users' },
    { command: 'stats', description: '📊 View total users and statistics' },
    { command: 'addtask', description: '➕ Add new task for users' },
    { command: 'deletetask', description: '🗑️ Delete existing task' },
    { command: 'tasks', description: '📋 View all active tasks' }
];


bot.setMyCommands(userCommands);
adminBot.setMyCommands(adminCommands);

console.log('Bot is running');


bot.onText(/\/start/, (msg) => handleStart( msg,bot));
bot.onText(/\/daily/, (msg) => handleDaily( msg, bot));
bot.onText(/\/balance/, (msg) => handleBalance( msg, bot));
bot.onText(/\/withdraw/, (msg) => handleWithdraw( msg, adminBot,bot,adminChatId));
bot.onText(/\/help/, (msg) => handleHelp( msg, bot,userCommands));
bot.onText(/\/settings/, (msg) => handleSettings( msg, bot));
bot.onText(/\/referrals/, (msg) => handleReferrals( msg,bot));
bot.on('contact', (msg) => handleContact( msg, bot));


adminBot.onText(/\/broadcast/, (msg) => handleBroadcast(msg,adminChatId,adminBot,bot ));
adminBot.onText(/\/stats/, (msg) => handleStats(msg, adminChatId,adminBot));
adminBot.onText(/\/addtask/, (msg) => handleAddTask(msg, adminChatId,adminBot));
adminBot.onText(/\/deletetask/, (msg) => handleDeleteTask(msg, adminChatId,adminBot));
adminBot.onText(/\/tasks/, (msg) => handleViewTasks(msg, adminChatId,adminBot));


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
        db.get(`SELECT points FROM tasks WHERE id = ?`, [taskIdNum], (err, task: any) => {
            if (err || !task) {
                bot.answerCallbackQuery(callbackQuery.id, { 
                    text: '❌ Error completing task'
                });
                return;
            }

            db.run(`INSERT INTO completed_tasks (user_id, task_id, completed_at) VALUES (?, ?, datetime('now'))`, 
                [userId, taskIdNum], (err) => {
                if (!err) {
                    db.run(`UPDATE users SET points = points + ? WHERE telegram_id = ?`, 
                        [task.points, userId], (err) => {
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
                                `🎯 You earned ${task.points} points!\n` +
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
        });
    }
})

adminBot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    
    if (!msg || !data || msg.chat.id.toString() !== adminChatId) return;
    //call back for delete task
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
    }else{// a callback for accept and reject withdraw 
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


