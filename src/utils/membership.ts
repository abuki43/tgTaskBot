require('dotenv').config()
import TelegramBot from 'node-telegram-bot-api';
import db from './database';

const bot = new TelegramBot(process.env.BOT_TOKEN as string);

export async function checkChannelMembership(userId: number, channelUsername: string): Promise<boolean> {
    try {
        const member = await bot.getChatMember(`@${channelUsername}`, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        console.error(`Error checking membership for ${channelUsername}:`, error);
        return false;
    }
}

export async function checkUserMembership(chatId: number): Promise<boolean> {
    const isMember1 = await checkChannelMembership(chatId, 'tasktest11');
    const isMember2 = await checkChannelMembership(chatId, 'tasktest11');
    return isMember1 && isMember2;
}