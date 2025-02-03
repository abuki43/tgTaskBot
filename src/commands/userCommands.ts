import TelegramBot from 'node-telegram-bot-api';
import db from '../utils/database';
import { checkUserMembership } from '../utils/membership';
import { addReferral, getReferralStats } from '../utils/database';



const watchingUsers = new Map<number, { taskId: number, startTime: number }>();
interface Task {
    id: number;
    title: string;
    video_url: string;
} 

export async function handleStart(msg: TelegramBot.Message, bot:TelegramBot) {
    const chatId = msg.chat.id;

    // Check user membership
    if (!await checkUserMembership(chatId)) {
        bot.sendMessage(chatId, 
            '⚠️ You must join the following channels to use the bot:\n' +
            '1. [Channel 1](https://t.me/tasktest11)\n' +
            '2. [Channel 2](https://t.me/tasktest11)\n\n' +
            'Please join the channels and then click /start again.', {
            parse_mode: 'Markdown'
        });
        return;
    }

    const startPayload = msg.text?.split(' ')[1] || ''; // Add optional chaining and default value

    // Check if user is already registered
    db.get(`SELECT is_registered FROM users WHERE telegram_id = ?`, [chatId], async (err, row: any) => {
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
            // Handle referral if exists
            if (startPayload && startPayload !== chatId.toString()) {
                const success = await addReferral(startPayload, chatId.toString());
                if (success) {
                    bot.sendMessage(startPayload, 
                        '🎉 *Congratulations!*\n\n' +
                        '👤 Someone joined using your referral link!\n' +
                        '💰 You earned 50 points!', {
                        parse_mode: 'Markdown'
                    });
                }
            }

            // Continue with normal registration
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
}

export async function handleContact(msg: TelegramBot.Message,bot:TelegramBot) {
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
}

export async function handleHelp(msg: TelegramBot.Message ,bot:TelegramBot, userCommands: { command: string, description: string }[]) {
    const chatId = msg.chat.id;
    const helpText = '🤖 *Available Commands:*\n\n' + userCommands
        .map(cmd => `/${cmd.command} - ${cmd.description}`)
        .join('\n') + '\n\n' +
        '💡 *Tips:*\n' +
        '• Complete daily tasks to earn points\n' +
        '• Watch videos fully to get rewards\n' +
        '• Refer friends to earn 50 points per referral\n' +
        '• Withdraw when you reach 30 points';
    
    bot.sendMessage(chatId, helpText, {
        parse_mode: 'Markdown'
    });
}

export async function handleReferrals(msg: TelegramBot.Message,bot:TelegramBot) {
    const chatId = msg.chat.id;
    const stats = await getReferralStats(chatId.toString());

    if (!stats) {
        return bot.sendMessage(chatId, '❌ Error fetching referral statistics.');
    }

    const referralLink = `https://t.me/${(await bot.getMe()).username}?start=${chatId}`;

    const message = `
🎯 *Your Referral Statistics*

👥 Total Referrals: ${stats.total_referrals}
💰 Referral Points Earned: ${stats.referral_points}
${stats.referred_by ? '🔄 You were referred by someone' : ''}

*How to Refer:*
1. Share your unique referral link
2. Earn 50 points for each new user
3. Your friend also gets bonus points!

🔗 *Your Referral Link:*
\`${referralLink}\`

💡 *Share this link with your friends to earn points!*`;

    bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '📤 Share Referral Link', url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join this amazing bot and earn points! Use my referral link:')}` }
            ]]
        }
    });
}

export async function handleWithdraw(msg: TelegramBot.Message, adminBot: TelegramBot,bot:TelegramBot, adminChatId: string) {
    const chatId = msg.chat.id;

    // Check user membership
    if (!await checkUserMembership(chatId)) {
        bot.sendMessage(chatId, 
            '⚠️ You must join the following channels to use the bot:\n' +
            '1. [Channel 1](https://t.me/tasktest11)\n' +
            '2. [Channel 2](https://t.me/tasktest12)\n\n' +
            'Please join the channels and then try again.', {
            parse_mode: 'Markdown'
        });
        return;
    }

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
}


export async function handleSettings(msg: TelegramBot.Message,bot:TelegramBot) {
    const chatId = msg.chat.id;

    
    db.get(
        `SELECT payment_method, payment_detail FROM users WHERE telegram_id = ?`, 
        [chatId], 
        (err, row: any) => {
            let currentDetailsText =  ""
            if (row && row.payment_method && row.payment_detail) {
                currentDetailsText = `\n\n*Current Payment Details:*\n` +
                    `Method: ${row.payment_method.toUpperCase()}\n` +
                    `Number: \`${row.payment_detail}\``;
            }
        
    bot.sendMessage(chatId, 
        '⚙️ *Payment Settings*\n\n' +
        'Choose payment method:\n' +
        '🏦 Available options:\n' +
        '• CBE Bank\n' +
        '• TeleBirr\n' +
        currentDetailsText+'\n\n' +
        'Select your preferred method:', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: 'CBE Bank 🏦', callback_data: 'set_cbe' },
                { text: 'TeleBirr ��', callback_data: 'set_telbirr' }
            ]]
        }
    });
})
}




export async function handleBalance(msg: TelegramBot.Message, bot:TelegramBot) {
    const chatId = msg.chat.id;

    // Check user membership
    if (!await checkUserMembership(chatId)) {
        bot.sendMessage(chatId, 
            '⚠️ You must join the following channels to use the bot:\n' +
            '1. [Channel 1](https://t.me/tasktest11)\n' +
            '2. [Channel 2](https://t.me/tasktest11)\n\n' +
            'Please join the channels and then try again.', {
            parse_mode: 'Markdown'
        });
        return;
    }

    db.get(`SELECT points FROM users WHERE telegram_id = ?`, [chatId], (err, row: any) => {
        if (row) {
            bot.sendMessage(chatId, `Your current balance is: ${row.points} points`);
        } else {
            bot.sendMessage(chatId, 'Please register first using /start');
        }
    });
}

export async function handleDaily(msg: TelegramBot.Message,bot:TelegramBot) {
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

        // bot.sendMessage(chatId, 
        //     '📋 *Daily Tasks Available*\n\n' +
        //     '💫 Complete these tasks to earn points!\n' +
        //     '⏱ Each task requires 20 seconds of watching\n' +
        //     '🎯 Earn 20 points per completed task', {
        //     parse_mode: 'Markdown'
        // });

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
}




