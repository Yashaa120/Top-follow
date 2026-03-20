import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";

dotenv.config();

console.log("Server script starting...");

interface UserData {
  id: string;
  username: string;
  firstName: string;
  points: number;
  referrals: number;
  referredBy: string | null;
  joined: boolean;
}

const USERS_FILE = path.join(process.cwd(), "users.json");
const SETTINGS_FILE = path.join(process.cwd(), "settings.json");

interface BotConfig {
  id: string;
  name: string;
  token: string;
  status: string;
  active: boolean;
}

interface Settings {
  dailyCodes: string[];
  activeCodes: string[];
  referralPoints: number;
  bots: BotConfig[];
  adminSecret: string;
  buttonNames: {
    getCodes: string;
    referEarn: string;
    profile: string;
    support: string;
    dailyCode: string;
    activeCodes: string;
  };
}

const defaultSettings: Settings = {
  dailyCodes: ["FREE500"],
  activeCodes: ["FREE500", "TOP777", "FOLLOW2024"],
  referralPoints: 1,
  bots: [],
  adminSecret: "adminpanelopen123",
  buttonNames: {
    getCodes: "💎 GET CODES 🎁",
    referEarn: "🤝 Refer & Earn",
    profile: "👤 Profile",
    support: "📞 Support",
    dailyCode: "🔥 Daily Code",
    activeCodes: "📋 Active Codes"
  }
};

function loadSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf8");
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
  return defaultSettings;
}

function saveSettings(settings: Settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error("Error saving settings:", error);
  }
}

function loadUsers(): Record<string, UserData> {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading users:", error);
  }
  return {};
}

function saveUsers(users: Record<string, UserData>) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error("Error saving users:", error);
  }
}

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

async function startServer() {
  console.log("🚀 Server starting...");
  console.log(`🔑 GEMINI_API_KEY: ${process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY" ? "SET (..." + process.env.GEMINI_API_KEY.substring(0, 5) + ")" : "NOT SET or DEFAULT"}`);
  console.log(`🤖 TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? "SET (..." + process.env.TELEGRAM_BOT_TOKEN.substring(0, 5) + ")" : "NOT SET"}`);
  console.log(`🤖 BOT_TOKEN: ${process.env.BOT_TOKEN ? "SET (..." + process.env.BOT_TOKEN.substring(0, 5) + ")" : "NOT SET"}`);
  console.log(`👤 ADMIN_USERNAME: ${process.env.ADMIN_USERNAME || "default (admin)"}`);
  console.log(`🔒 ADMIN_PASSWORD: ${process.env.ADMIN_PASSWORD ? "SET (..." + process.env.ADMIN_PASSWORD.substring(0, 2) + ")" : "default (password123)"}`);

  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  
  let lastMessages: any[] = [];

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/bot-status", (req, res) => {
    res.json({ messages: lastMessages, settings });
  });

  // Load users into memory
  let users = loadUsers();
  let settings = loadSettings();

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: geminiKey || "" });

  const botInstances = new Map<string, { bot: TelegramBot, token: string }>();
  const authenticatedAdmins = new Set<number>();
  const customCommands = new Map<string, string>();

  async function setupBot(botConfig: BotConfig) {
    const { id, active } = botConfig;
    const token = (botConfig.token || "").trim();

    // Stop existing instance if any
    if (botInstances.has(id)) {
      try {
        const { bot: oldBot } = botInstances.get(id)!;
        await oldBot.stopPolling();
        botInstances.delete(id);
        console.log(`Stopped bot instance: ${id}`);
      } catch (err) {
        console.error(`Error stopping bot ${id}:`, err);
      }
    }

    // Check if another bot instance is already using this token
    for (const [existingId, { token: existingToken }] of botInstances.entries()) {
      if (existingToken === token) {
        console.log(`⚠️ Bot ${id} skipped: Token already in use by bot ${existingId}`);
        updateBotStatus(id, `Error: Duplicate Token (Used by ${existingId})`);
        return;
      }
    }

    // Basic token format validation (e.g., 123456789:ABCDefghIJKLmnopQRSTuvwxYZ)
    const tokenRegex = /^\d+:[a-zA-Z0-9_-]{20,}$/;
    if (!active || !token || token === "YOUR_BOT_TOKEN" || !tokenRegex.test(token)) {
      console.log(`⚠️ Bot ${id} skipped: active=${active}, tokenPresent=${!!token}, validFormat=${tokenRegex.test(token)}`);
      updateBotStatus(id, token && !tokenRegex.test(token) ? "Error: Invalid Token Format" : "Inactive");
      return;
    }

    try {
      console.log(`🚀 Attempting to connect bot ${id} with token: ${token.substring(0, 10)}...`);
      const bot = new TelegramBot(token, { polling: true });
      botInstances.set(id, { bot, token });
      updateBotStatus(id, "Connecting...");

      bot.on("polling_error", (error: any) => {
        console.error(`❌ Telegram Polling Error (${id}):`, error.message);
        if (error.message.includes("404 Not Found") || error.message.includes("401 Unauthorized")) {
          updateBotStatus(id, `Error: ${error.message.includes("401") ? "Invalid Token (401)" : "Invalid Token (404)"}`);
          bot.stopPolling();
        } else if (error.message.includes("409 Conflict")) {
          updateBotStatus(id, "Error: Conflict (Multiple Instances)");
          bot.stopPolling();
        } else {
          updateBotStatus(id, "Error: Connection Issue");
        }
      });

      bot.on("error", (error: any) => {
        console.error(`Telegram General Error (${id}):`, error.message);
        if (error.message.includes("404 Not Found")) {
          updateBotStatus(id, "Error: Invalid Token (404)");
          bot.stopPolling();
        } else {
          updateBotStatus(id, "Error: Bot Crashed");
        }
      });

      const me = await bot.getMe();
      const botName = me.username || "Bot";
      updateBotStatus(id, "Connected", botName);
      console.log(`✅ Bot @${botName} (${id}) is successfully connected!`);

      // Attach listeners
      attachBotListeners(bot, botName);
    } catch (err: any) {
      console.error(`❌ Failed to initialize bot ${id}:`, err.message);
      updateBotStatus(id, `Error: ${err.message}`);
    }
  }

  function updateBotStatus(id: string, status: string, name?: string) {
    const botIndex = settings.bots.findIndex(b => b.id === id);
    if (botIndex !== -1) {
      settings.bots[botIndex].status = status;
      if (name) settings.bots[botIndex].name = name;
    }
  }

  function attachBotListeners(bot: TelegramBot, botName: string) {
    console.log(`🎧 Attaching listeners to bot @${botName}`);
    bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from?.id?.toString();
        if (!userId) return;

        const refParam = match ? match[1] : null;

        // Initialize user if not exists
        if (!users[userId]) {
          let referredBy: string | null = null;
          console.log(`🆕 New user detected: ${userId}. refParam: ${refParam}`);
          if (refParam && refParam.startsWith("ref_")) {
            const referrerId = refParam.replace("ref_", "");
            console.log(`🔍 Checking referrer: ${referrerId}`);
            if (referrerId && referrerId !== userId && users[referrerId]) {
              referredBy = referrerId;
              console.log(`🔗 Referrer found: ${referrerId}`);
            } else {
              console.log(`❌ Referrer not found or invalid: ${referrerId}`);
            }
          }

          users[userId] = {
            id: userId,
            username: msg.from?.username || "",
            firstName: msg.from?.first_name || "User",
            points: 0,
            referrals: 0,
            referredBy: referredBy,
            joined: false
          };
          saveUsers(users);
        } else if (!users[userId].joined && refParam && refParam.startsWith("ref_")) {
          // If user exists but hasn't joined yet, allow setting referrer
          const referrerId = refParam.replace("ref_", "");
          if (referrerId && referrerId !== userId && users[referrerId] && !users[userId].referredBy) {
            users[userId].referredBy = referrerId;
            saveUsers(users);
          }
        }

        const welcomeMessage = "🚫 <b>ACCESS RESTRICTED</b>\n_________________________\n\nTo access the bot, you must be a member of our channels.";
        const options: TelegramBot.SendMessageOptions = {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "👉 Join Priyanka Grow", url: "https://t.me/priyankagrow" }],
              [{ text: "👉 Join Top Follow Codes Chat", url: "https://t.me/topfollowcodeschat" }],
              [{ text: "👉 Join Top Follow Codes Official", url: "https://t.me/topfollowcodesofficial" }],
              [{ text: "✅ I Have Joined", callback_data: "check_joined" }]
            ]
          }
        };
        bot.sendMessage(chatId, welcomeMessage, options);
      });

      bot.on("callback_query", async (callbackQuery) => {
        console.log(`🖱️ [${botName}] Callback Query: ${callbackQuery.data} from ${callbackQuery.from.first_name}`);
        const msg = callbackQuery.message;
        if (!msg) return;
        const data = callbackQuery.data;

        if (data === "check_joined") {
          const userId = callbackQuery.from.id.toString();
          const channels = ["@priyankagrow", "@topfollowcodeschat", "@topfollowcodesofficial"];
          
          let allJoined = true;
          for (const channel of channels) {
            try {
              const member = await bot.getChatMember(channel, userId);
              if (member.status === "left" || member.status === "kicked") {
                allJoined = false;
                break;
              }
            } catch (error: any) {
              const errorDesc = error.response?.body?.description || "";
              if (errorDesc.includes("member list is inaccessible")) {
                console.error(`❌ PERMISSION ERROR: Bot is not an Admin in ${channel}. It cannot verify members.`);
                allJoined = false;
              } else if (errorDesc.includes("chat not found")) {
                console.error(`❌ CONFIG ERROR: Channel ${channel} not found. Check the username.`);
                allJoined = false;
              } else {
                console.error(`Error checking membership for ${channel}:`, error);
                allJoined = false;
              }
              break;
            }
          }

          if (allJoined) {
            const user = users[userId];
            if (user && !user.joined) {
              user.joined = true;
              
              // Log event for admin panel
              lastMessages.unshift({
                user: "SYSTEM",
                text: `👤 User ${user.firstName} (@${user.username}) successfully joined all channels.`,
                time: new Date().toLocaleTimeString()
              });

              console.log(`👤 User ${userId} joined. Checking for referrer...`);
              // If referred by someone, give them points
              if (user.referredBy && users[user.referredBy]) {
                const referrer = users[user.referredBy];
                referrer.points += settings.referralPoints;
                referrer.referrals += 1;
                
                // Log event for admin panel
                lastMessages.unshift({
                  user: "SYSTEM",
                  text: `🔗 Referral: ${user.firstName} joined via ${referrer.firstName}. Referrer earned ${settings.referralPoints} points.`,
                  time: new Date().toLocaleTimeString()
                });

                console.log(`✅ Referral successful! Referrer ${user.referredBy} earned ${settings.referralPoints} points. New balance: ${referrer.points}`);
                bot.sendMessage(user.referredBy, `🎉 New Referral!\n+ ${settings.referralPoints} Points added.`);
              } else {
                console.log(`⚠️ User ${userId} has no referrer or referrer not found: ${user.referredBy}`);
              }
              saveUsers(users);
            } else {
              console.log(`ℹ️ User ${userId} already joined or not found.`);
            }

            const firstName = callbackQuery.from.first_name || "User";
            bot.answerCallbackQuery(callbackQuery.id, { text: "✅ Access Granted!" });
            
            const successMessage = `👋 Welcome, <b>${firstName}</b>.\n_________________________\n\n💎 <b>LOOT SYSTEM</b> 💎\n\nRefer friends. Earn points. Redeem premium loot for FREE.\n\nSelect an option below to begin.`;
            
            const options: TelegramBot.SendMessageOptions = {
              parse_mode: "HTML",
              reply_markup: {
                keyboard: [
                  [
                    { text: settings.buttonNames.getCodes },
                    { text: settings.buttonNames.referEarn }
                  ],
                  [
                    { text: settings.buttonNames.profile },
                    { text: settings.buttonNames.support }
                  ],
                  [
                    { text: settings.buttonNames.dailyCode },
                    { text: settings.buttonNames.activeCodes }
                  ]
                ],
                resize_keyboard: true
              }
            };
            
            bot.sendMessage(msg.chat.id, successMessage, options);
          } else {
            bot.answerCallbackQuery(callbackQuery.id, { 
              text: "❌ You are still missing channels!", 
              show_alert: true 
            });
          }
        } else if (data === "redeem_1k") {
          const userId = callbackQuery.from.id.toString();
          const user = users[userId];
          if (!user || user.points < 6) {
            bot.answerCallbackQuery(callbackQuery.id, { 
              text: "❌ Not enough points! You need 6 Points.", 
              show_alert: true 
            });
          } else {
            user.points -= 6;
            saveUsers(users);
            
            // Log event for admin panel
            lastMessages.unshift({
              user: "SYSTEM",
              text: `🎁 Redemption: ${user.firstName} (@${user.username}) redeemed 1k followers for 6 points.`,
              time: new Date().toLocaleTimeString()
            });

            bot.answerCallbackQuery(callbackQuery.id, { 
              text: "✅ Redeemed successfully! Contact support to claim your followers.", 
              show_alert: true 
            });
            bot.sendMessage(msg.chat.id, "✅ <b>REDEEM SUCCESSFUL</b>\n\n6 Points have been deducted from your balance.\n\nPlease contact @Topfollow_officials with your ID and screenshot to claim your 1k followers.", { parse_mode: "HTML" });
          }
        }
      });

      bot.onText(/\/echo (.+)/, (msg, match) => {
        if (!match) return;
        const resp = match[1];
        bot.sendMessage(msg.chat.id, `📢 <b>Echo:</b> ${resp}`, { parse_mode: "HTML" });
      });

      bot.onText(/\/ping/, (msg) => {
        console.log(`🏓 [${botName}] Ping received from ${msg.from?.first_name}`);
        bot.sendMessage(msg.chat.id, "🏓 <b>PONG!</b> I am alive and listening.", { parse_mode: "HTML" });
      });

      bot.onText(/\/admin/, (msg) => {
        console.log(`🔐 [${botName}] Admin command received from ${msg.from?.first_name}`);
        const appUrl = (process.env.APP_URL || "https://ais-dev-rzbx5hupfvpx2d3wg3ablv-376426211502.asia-east1.run.app").replace(/\/$/, "");
        const currentSecret = process.env.ADMIN_SECRET || settings.adminSecret;
        const adminUrl = `${appUrl}?secret=${currentSecret}`;

        const adminMsg = `🔐 <b>ADMIN ACCESS</b>\n_________________________\n\n🌐 <b>Web Dashboard:</b>\n<a href="${adminUrl}">Open Admin Panel</a>\n\n🤖 <b>Bot Admin Login:</b>\nPlease enter your <b>Admin Username</b> and <b>Password</b> in the following format:\n\n<code>login [username] [password]</code>\n\n<i>Example: login admin password123</i>`;
        bot.sendMessage(msg.chat.id, adminMsg, { parse_mode: "HTML" });
      });

      bot.onText(/login (\w+) (.+)/, (msg, match) => {
        if (!match) return;
        const username = match[1];
        const password = match[2];
        
        const adminUsername = process.env.ADMIN_USERNAME || "admin";
        const adminPassword = process.env.ADMIN_PASSWORD || "password123";

        if (username === adminUsername && password === adminPassword) {
          authenticatedAdmins.add(msg.chat.id);
          const successMsg = "✅ <b>ADMIN LOGGED IN</b>\n_________________________\n\nYou now have access to admin commands via Telegram.\n\n<b>Commands:</b>\n/stats - View bot statistics\n/broadcast [msg] - Send message to all users\n/bots - Manage bot instances\n/logout - End admin session";
          bot.sendMessage(msg.chat.id, successMsg, { parse_mode: "HTML" });
        } else {
          bot.sendMessage(msg.chat.id, "❌ <b>INVALID CREDENTIALS</b>\n\nPlease try again.", { parse_mode: "HTML" });
        }
      });

      bot.onText(/\/logout/, (msg) => {
        if (authenticatedAdmins.has(msg.chat.id)) {
          authenticatedAdmins.delete(msg.chat.id);
          bot.sendMessage(msg.chat.id, "🔒 <b>LOGGED OUT</b>\n\nYour admin session has ended.", { parse_mode: "HTML" });
        }
      });

      bot.onText(/\/adminpanelopen123/, (msg) => {
        const appUrl = (process.env.APP_URL || "https://ais-dev-rzbx5hupfvpx2d3wg3ablv-376426211502.asia-east1.run.app").replace(/\/$/, "");
        const adminUrl = `${appUrl}?secret=${settings.adminSecret}`;
        bot.sendMessage(msg.chat.id, `🔐 <b>ADMIN PANEL ACCESS</b>\n\nClick the link below to access the admin panel:\n\n<a href="${adminUrl}">Open Admin Panel</a>`, { parse_mode: "HTML" });
      });

      bot.onText(/\/stats/, (msg) => {
        if (!authenticatedAdmins.has(msg.chat.id)) {
          bot.sendMessage(msg.chat.id, "❌ <b>UNAUTHORIZED</b>\n\nPlease use /admin to login first.", { parse_mode: "HTML" });
          return;
        }
        const userCount = Object.keys(users).length;
        const activeBots = Array.from(botInstances.values()).length;
        const statsMsg = `📊 <b>BOT STATISTICS</b>\n_________________________\n\n👥 <b>Total Users:</b> ${userCount}\n🤖 <b>Active Bots:</b> ${activeBots}\n💎 <b>Referral Points:</b> ${settings.referralPoints}`;
        bot.sendMessage(msg.chat.id, statsMsg, { parse_mode: "HTML" });
      });

      bot.onText(/\/bots/, (msg) => {
        if (!authenticatedAdmins.has(msg.chat.id)) {
          bot.sendMessage(msg.chat.id, "❌ <b>UNAUTHORIZED</b>\n\nPlease use /admin to login first.", { parse_mode: "HTML" });
          return;
        }
        let botList = "🤖 <b>MANAGED BOTS</b>\n_________________________\n\n";
        settings.bots.forEach((b, i) => {
          botList += `${i + 1}. <b>${b.name || 'Unnamed'}</b>\n   Status: ${b.status}\n   Active: ${b.active ? '✅' : '❌'}\n\n`;
        });
        if (settings.bots.length === 0) botList += "No bots configured.";
        bot.sendMessage(msg.chat.id, botList, { parse_mode: "HTML" });
      });

      bot.onText(/\/broadcast (.+)/, async (msg, match) => {
        if (!authenticatedAdmins.has(msg.chat.id)) {
          bot.sendMessage(msg.chat.id, "❌ <b>UNAUTHORIZED</b>\n\nPlease use /admin to login first.", { parse_mode: "HTML" });
          return;
        }
        if (!match) return;
        const broadcastMsg = match[1];
        
        bot.sendMessage(msg.chat.id, "📢 <b>BROADCAST STARTED</b>\n\nSending message to all users...", { parse_mode: "HTML" });

        let successCount = 0;
        let failCount = 0;
        const userIds = Object.keys(users);

        for (const id of userIds) {
          try {
            // Try sending via current bot first
            await bot.sendMessage(id, broadcastMsg, { parse_mode: "HTML" });
            successCount++;
          } catch (err) {
            // Try other bots if current fails
            let sent = false;
            for (const [botId, { bot: otherBot }] of botInstances.entries()) {
              try {
                await otherBot.sendMessage(id, broadcastMsg, { parse_mode: "HTML" });
                successCount++;
                sent = true;
                break;
              } catch (e) {
                continue;
              }
            }
            if (!sent) failCount++;
          }
        }

        bot.sendMessage(msg.chat.id, `✅ <b>BROADCAST COMPLETE</b>\n_________________________\n\n👥 <b>Success:</b> ${successCount}\n❌ <b>Failed:</b> ${failCount}`, { parse_mode: "HTML" });
      });

      bot.onText(/\/help/, (msg) => {
        console.log(`❓ [${botName}] Help command received from ${msg.from?.first_name}`);
        let helpMessage = "🚀 <b>HELP MENU</b>\n_________________________\n\nI provide daily codes for the Top Follow app to help you get free followers.\n\n<b>Commands:</b>\n<code>/daily</code> - Get today's code\n<code>/code</code> - Show all active codes\n<code>/list</code> - See custom commands\n<code>/admin</code> - Access Admin Panel";
        
        if (authenticatedAdmins.has(msg.chat.id)) {
          helpMessage += "\n\n🔐 <b>ADMIN COMMANDS:</b>\n<code>/stats</code> - View bot stats\n<code>/broadcast [msg]</code> - Broadcast to all\n<code>/bots</code> - View bot instances\n<code>/logout</code> - End session";
        } else {
          helpMessage += "\n\n🔐 <b>ADMIN:</b>\n<code>/admin</code> - Login to admin panel";
        }
        
        bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: "HTML" });
      });

      bot.onText(/\/daily/, (msg) => {
        const codes = settings.dailyCodes && settings.dailyCodes.length > 0 
          ? settings.dailyCodes.map(c => `👉 <code>${c}</code>`).join('\n')
          : `👉 <code>NO CODE TODAY</code>`;
        const dailyMessage = `🔥 <b>TODAY'S TOP FOLLOW CODES</b>\n_________________________\n\n${codes}\n\nUse these in the app to get free coins!`;
        bot.sendMessage(msg.chat.id, dailyMessage, { parse_mode: "HTML" });
      });

      bot.onText(/\/code/, (msg) => {
        let codeList = settings.activeCodes.map((c, i) => `${i + 1}. <code>${c}</code>`).join("\n");
        const codeMessage = `📋 <b>ACTIVE TOP FOLLOW CODES</b>\n_________________________\n\n${codeList}\n\nType /daily for the freshest code!`;
        bot.sendMessage(msg.chat.id, codeMessage, { parse_mode: "HTML" });
      });

      // Command to set custom responses: /set hello Hi there!
      bot.onText(/\/set (\w+) (.+)/, (msg, match) => {
        if (!match) return;
        const cmd = match[1].toLowerCase();
        const response = match[2];
        customCommands.set(cmd, response);
        bot.sendMessage(msg.chat.id, `✅ Command <code>/${cmd}</code> has been set!`, { parse_mode: "HTML" });
      });

      bot.onText(/\/list/, (msg) => {
        if (customCommands.size === 0) {
          bot.sendMessage(msg.chat.id, "No custom commands set yet. Use /set to create one!");
          return;
        }
        let list = "📋 <b>CUSTOM COMMANDS</b>\n_________________________\n\n";
        customCommands.forEach((val, key) => {
          list += `<code>/${key}</code> - ${val}\n`;
        });
        bot.sendMessage(msg.chat.id, list, { parse_mode: "HTML" });
      });

      bot.on("message", async (msg) => {
        if (!msg.text) return;
        console.log(`📩 [${botName}] Received: ${msg.text} from ${msg.from?.first_name}`);
        
        const userId = msg.from?.id?.toString();
        if (!userId) return;

        // Log message for UI
        lastMessages.unshift({
          user: msg.from?.first_name || "User",
          text: msg.text,
          time: new Date().toLocaleTimeString()
        });
        if (lastMessages.length > 50) lastMessages.pop();

        // Handle custom commands
        if (msg.text.startsWith("/")) {
          const cmd = msg.text.substring(1).split(" ")[0].toLowerCase();
          if (customCommands.has(cmd)) {
            bot.sendMessage(msg.chat.id, customCommands.get(cmd)!);
            return;
          }
          // If it's a command but not handled, ignore or send error
          if (["start", "help", "set", "list", "daily", "code", "ping", "admin"].includes(cmd)) return;
        }

        // Handle Keyboard Button Clicks
        if (msg.text === settings.buttonNames.getCodes) {
          const user = users[userId];
          const points = user ? user.points : 0;
          const redeemMessage = `🎁 <b>REDEEM SHOP</b>\n_________________________\n\n💎 Your Balance: ${points} Points\n👇 Available Loot:\n\n<i>Click an item to redeem instantly.</i>`;
          bot.sendMessage(msg.chat.id, redeemMessage, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎟️ Top followers 1k (6 Pts)", callback_data: "redeem_1k" }]
              ]
            }
          });
        } else if (msg.text === settings.buttonNames.referEarn) {
          const referralMessage = `🤝 <b>REFERRAL PROGRAM</b>\n_________________________\n\nInvite friends and earn points to redeem premium loot.\n\n🎁 Reward: ${settings.referralPoints} Points / User\n🔗 Your Link:\n<code>https://t.me/${botName}?start=ref_${userId}</code>\n\n<i>Tap to copy.</i>`;
          bot.sendMessage(msg.chat.id, referralMessage, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚀 Share Link", url: `https://t.me/share/url?url=https://t.me/${botName}?start=ref_${userId}&text=Get%20free%20Instagram%20followers%20using%20this%20bot!%20🚀` }]
              ]
            }
          });
        } else if (msg.text === settings.buttonNames.profile) {
          const user = users[userId];
          const points = user ? user.points : 0;
          const profileMessage = `👤 <b>USER DASHBOARD</b>\n_________________________\n\n🆔 ID: <code>${userId}</code>\n💎 Balance: ${points} Points\n_________________________`;
          bot.sendMessage(msg.chat.id, profileMessage, { parse_mode: "HTML" });
        } else if (msg.text === settings.buttonNames.support) {
          bot.sendMessage(msg.chat.id, "📞 <b>SUPPORT</b>\n_________________________\n\nContact: @Topfollow_officials", { parse_mode: "HTML" });
        } else if (msg.text === settings.buttonNames.dailyCode) {
          const codes = settings.dailyCodes && settings.dailyCodes.length > 0 
            ? settings.dailyCodes.map(c => `👉 <code>${c}</code>`).join('\n')
            : `👉 <code>NO CODE TODAY</code>`;
          const dailyMessage = `🔥 <b>TODAY'S TOP FOLLOW CODES</b>\n_________________________\n\n${codes}\n\nUse these in the app to get free coins!`;
          bot.sendMessage(msg.chat.id, dailyMessage, { parse_mode: "HTML" });
        } else if (msg.text === settings.buttonNames.activeCodes) {
          let codeList = settings.activeCodes.map((c, i) => `${i + 1}. <code>${c}</code>`).join("\n");
          const codeMessage = `📋 <b>ACTIVE TOP FOLLOW CODES</b>\n_________________________\n\n${codeList}\n\nType /daily for the freshest code!`;
          bot.sendMessage(msg.chat.id, codeMessage, { parse_mode: "HTML" });
        }

        // Default: Use Gemini AI for natural conversation
        if (!msg.text.startsWith("/") && ![settings.buttonNames.getCodes, settings.buttonNames.referEarn, settings.buttonNames.profile, settings.buttonNames.support, settings.buttonNames.dailyCode, settings.buttonNames.activeCodes].includes(msg.text)) {
          if (!geminiKey || geminiKey === "YOUR_GEMINI_API_KEY") {
            bot.sendMessage(msg.chat.id, "🤖 <b>AI NOT CONFIGURED</b>\n_________________________\n\nPlease set your <code>GEMINI_API_KEY</code> in the AI Studio Secrets panel to enable AI chat.");
            return;
          }
          try {
            bot.sendChatAction(msg.chat.id, "typing");
            const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: [{ parts: [{ text: msg.text }] }],
              config: {
                systemInstruction: "You are the 'Top Follow Codes' bot. You help users get free Instagram followers by providing codes for the Top Follow app. You are friendly, energetic, and use emojis. Your messages should be professional and consistent with the bot's UI design (using separators like '_________________________' and bold headers). Use HTML tags for formatting: <b>bold</b>, <i>italic</i>, <code>code</code>. If users ask for codes, give them 'FREE500'. If they ask about the app, explain it helps get followers. Users can refer friends to earn points and redeem premium loot for FREE."
              }
            });
            
            const aiText = response.text || "I'm not sure how to respond to that.";
            console.log(`📤 [${botName}] Sending AI response to ${msg.chat.id}: ${aiText.substring(0, 50)}...`);
            await bot.sendMessage(msg.chat.id, aiText, { parse_mode: "HTML" });
          } catch (error: any) {
            console.error("Gemini/Message Error:", error.message);
            try {
              // Fallback without HTML if it was an HTML error
              await bot.sendMessage(msg.chat.id, "Sorry, I'm having trouble thinking right now. 🤖");
            } catch (e) {
              console.error("Final Fallback Error:", e);
            }
          }
        }
      });
  }

  // Initial bot setup
  if (settings.bots && settings.bots.length > 0) {
    settings.bots.forEach(botConfig => setupBot(botConfig));
  } else if (token && token !== "YOUR_BOT_TOKEN") {
    console.log("🤖 No bots in settings, but TELEGRAM_BOT_TOKEN found. Creating default bot...");
    const defaultBot: BotConfig = {
      id: "default-bot",
      name: "Default Bot",
      token: token,
      status: "Initializing",
      active: true
    };
    settings.bots = [defaultBot];
    saveSettings(settings);
    setupBot(defaultBot);
  }

  // Admin credentials
  const adminUsername = (process.env.ADMIN_USERNAME || "admin").trim();
  const adminPassword = (process.env.ADMIN_PASSWORD || "password123").trim();
  const currentSecret = process.env.ADMIN_SECRET || settings.adminSecret;

  console.log(`ℹ️ Admin credentials initialized: username="${adminUsername}", password="${adminPassword.substring(0, 2)}***", secret="${currentSecret}"`);

  app.post("/api/admin/login", (req, res) => {
    const { secret } = req.body;
    const trimmedSecret = (secret || "").trim();
    
    // Allow override via environment variable
    const envSecret = process.env.ADMIN_SECRET;
    const expectedSecret = envSecret || settings.adminSecret;
    
    console.log(`🔐 Admin login attempt with secret: "${trimmedSecret}"`);
    
    if (trimmedSecret === expectedSecret) {
      console.log("✅ Admin login successful");
      res.json({ success: true, token: "admin-token-123" });
    } else {
      console.log(`❌ Admin login failed: expected "${expectedSecret}", got "${trimmedSecret}"`);
      res.status(401).json({ 
        success: false, 
        message: "Invalid secret key",
        debug: process.env.NODE_ENV !== "production" ? `Expected: ${expectedSecret}` : undefined
      });
    }
  });

  // Simple middleware to check admin token
  const checkAdmin = (req: any, res: any, next: any) => {
    const token = req.headers["x-admin-token"];
    if (token === "admin-token-123") {
      next();
    } else {
      res.status(403).json({ error: "Unauthorized" });
    }
  };

  // Admin API routes
  app.get("/api/admin/users", checkAdmin, (req, res) => {
    res.json(Object.values(users));
  });

  app.post("/api/admin/settings", checkAdmin, (req, res) => {
    const oldBots = [...(settings.bots || [])];
    settings = { ...settings, ...req.body };
    saveSettings(settings);

    // Sync bots
    if (settings.bots) {
      settings.bots.forEach(newBot => {
        const oldBot = oldBots.find(b => b.id === newBot.id);
        if (!oldBot || oldBot.token !== newBot.token || oldBot.active !== newBot.active) {
          setupBot(newBot);
        }
      });
    }

    // Stop removed bots
    oldBots.forEach(oldBot => {
      if (!settings.bots || !settings.bots.find(b => b.id === oldBot.id)) {
        if (botInstances.has(oldBot.id)) {
          botInstances.get(oldBot.id)?.bot.stopPolling();
          botInstances.delete(oldBot.id);
        }
      }
    });

    res.json({ success: true, settings });
  });

  app.post("/api/admin/users/:id/points", checkAdmin, (req, res) => {
    const { id } = req.params;
    const { points } = req.body;
    if (users[id]) {
      users[id].points = points;
      saveUsers(users);
      res.json({ success: true, user: users[id] });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  app.post("/api/admin/send-message", checkAdmin, async (req, res) => {
    const { userId, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: "Missing userId or message" });

    let sent = false;
    for (const [botId, { bot }] of botInstances.entries()) {
      try {
        await bot.sendMessage(userId, message, { parse_mode: "HTML" });
        sent = true;
        break;
      } catch (err) {
        console.error(`Failed to send via bot ${botId} to user ${userId}:`, err);
      }
    }

    if (sent) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: "Failed to send message through any bot" });
    }
  });

  app.post("/api/admin/broadcast", checkAdmin, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    let successCount = 0;
    let failCount = 0;

    const userIds = Object.keys(users);
    for (const id of userIds) {
      try {
        // Broadcast through all active bots
        for (const [botId, { bot }] of botInstances.entries()) {
          try {
            await bot.sendMessage(id, message, { parse_mode: "HTML" });
            successCount++;
            break; // Successfully sent through one bot, move to next user
          } catch (err) {
            console.error(`Failed to send via bot ${botId} to user ${id}:`, err);
          }
        }
      } catch (err) {
        failCount++;
      }
    }
    res.json({ success: true, successCount, failCount });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
