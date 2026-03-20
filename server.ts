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

interface Settings {
  dailyCode: string;
  activeCodes: string[];
  referralPoints: number;
}

const defaultSettings: Settings = {
  dailyCode: "FREE500",
  activeCodes: ["FREE500", "TOP777", "FOLLOW2024"],
  referralPoints: 1
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
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  
  let botStatus = "Disconnected";
  let botName = "Unknown";
  let lastMessages: any[] = [];

  // Load users into memory
  let users = loadUsers();
  let settings = loadSettings();

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: geminiKey || "" });

  let bot: TelegramBot | null = null;

  if (token && token !== "YOUR_BOT_TOKEN") {
    try {
      console.log("Attempting to connect to Telegram...");
      bot = new TelegramBot(token, { polling: true });
      
      bot.on("polling_error", (error) => {
        console.error("Telegram Polling Error:", error.message);
        botStatus = "Error: Connection Issue";
      });

      bot.on("error", (error) => {
        console.error("Telegram General Error:", error.message);
        botStatus = "Error: Bot Crashed";
      });

      botStatus = "Connecting...";
      
      bot.getMe().then((me) => {
        botName = me.username || "Bot";
        botStatus = "Connected";
        console.log(`✅ Bot @${botName} is successfully connected!`);
      }).catch((err) => {
        console.error("❌ Failed to get bot info:", err.message);
        botStatus = "Error: Invalid Token";
      });

      // Custom commands store (in-memory for simplicity)
      const customCommands = new Map<string, string>();

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
              console.log(`👤 User ${userId} joined. Checking for referrer...`);
              // If referred by someone, give them points
              if (user.referredBy && users[user.referredBy]) {
                const referrer = users[user.referredBy];
                referrer.points += settings.referralPoints;
                referrer.referrals += 1;
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
            
            const successMessage = `👋 Welcome, <b>${firstName}</b>.\n_________________________\n\n💎 <b>LOOT SYSTEM</b> 💎\n\nRefer friends. Earn points. Redeem Shein Coupons for FREE.\n\nSelect an option below to begin.`;
            
            const options: TelegramBot.SendMessageOptions = {
              parse_mode: "HTML",
              reply_markup: {
                keyboard: [
                  [
                    { text: "💎 GET CODES 🎁" },
                    { text: "🤝 Refer & Earn" }
                  ],
                  [
                    { text: "👤 Profile" },
                    { text: "📞 Support" }
                  ],
                  [
                    { text: "🔥 Daily Code" },
                    { text: "📋 Active Codes" }
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
            bot.answerCallbackQuery(callbackQuery.id, { 
              text: "✅ Redeemed successfully! Contact support to claim your followers.", 
              show_alert: true 
            });
            bot.sendMessage(msg.chat.id, "✅ <b>REDEEM SUCCESSFUL</b>\n\n6 Points have been deducted from your balance.\n\nPlease contact @Topfollow_officials with your ID and screenshot to claim your 1k followers.", { parse_mode: "HTML" });
          }
        }
      });

      bot.onText(/\/help/, (msg) => {
        const helpMessage = "🚀 <b>HELP MENU</b>\n_________________________\n\nI provide daily codes for the Top Follow app to help you get free followers.\n\n<b>Commands:</b>\n<code>/daily</code> - Get today's code\n<code>/code</code> - Show all active codes\n<code>/list</code> - See custom commands\n<code>/set [cmd] [text]</code> - Create your own command";
        bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: "HTML" });
      });

      bot.onText(/\/daily/, (msg) => {
        const dailyMessage = `🔥 <b>TODAY'S TOP FOLLOW CODE</b>\n_________________________\n\n👉 <code>${settings.dailyCode}</code>\n\nUse this in the app to get free coins!`;
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
        const userId = msg.from?.id?.toString();
        if (!userId) return;

        // Log message for UI
        lastMessages.unshift({
          user: msg.from?.first_name || "User",
          text: msg.text,
          time: new Date().toLocaleTimeString()
        });
        if (lastMessages.length > 10) lastMessages.pop();

        // Handle custom commands
        if (msg.text.startsWith("/")) {
          const cmd = msg.text.substring(1).split(" ")[0].toLowerCase();
          if (customCommands.has(cmd)) {
            bot.sendMessage(msg.chat.id, customCommands.get(cmd)!);
            return;
          }
          // If it's a command but not handled, ignore or send error
          if (["start", "help", "set", "list", "daily", "code"].includes(cmd)) return;
        }

        // Handle Keyboard Button Clicks
        if (msg.text === "💎 GET CODES 🎁") {
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
        } else if (msg.text === "🤝 Refer & Earn") {
          const referralMessage = `🤝 <b>REFERRAL PROGRAM</b>\n_________________________\n\nInvite friends and earn points to redeem premium loot.\n\n🎁 Reward: ${settings.referralPoints} Points / User\n🔗 Your Link:\n<code>https://t.me/${botName}?start=ref_${userId}</code>\n\n<i>Tap to copy.</i>`;
          bot.sendMessage(msg.chat.id, referralMessage, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚀 Share Link", url: `https://t.me/share/url?url=https://t.me/${botName}?start=ref_${userId}&text=Get%20free%20Instagram%20followers%20using%20this%20bot!%20🚀` }]
              ]
            }
          });
        } else if (msg.text === "👤 Profile") {
          const user = users[userId];
          const points = user ? user.points : 0;
          const profileMessage = `👤 <b>USER DASHBOARD</b>\n_________________________\n\n🆔 ID: <code>${userId}</code>\n💎 Balance: ${points} Points\n_________________________`;
          bot.sendMessage(msg.chat.id, profileMessage, { parse_mode: "HTML" });
        } else if (msg.text === "📞 Support") {
          bot.sendMessage(msg.chat.id, "📞 <b>SUPPORT</b>\n_________________________\n\nContact: @Topfollow_officials", { parse_mode: "HTML" });
        } else if (msg.text === "🔥 Daily Code") {
          const dailyMessage = `🔥 <b>TODAY'S TOP FOLLOW CODE</b>\n_________________________\n\n👉 <code>${settings.dailyCode}</code>\n\nUse this in the app to get free coins!`;
          bot.sendMessage(msg.chat.id, dailyMessage, { parse_mode: "HTML" });
        } else if (msg.text === "📋 Active Codes") {
          let codeList = settings.activeCodes.map((c, i) => `${i + 1}. <code>${c}</code>`).join("\n");
          const codeMessage = `📋 <b>ACTIVE TOP FOLLOW CODES</b>\n_________________________\n\n${codeList}\n\nType /daily for the freshest code!`;
          bot.sendMessage(msg.chat.id, codeMessage, { parse_mode: "HTML" });
        }

        // Default: Use Gemini AI for natural conversation
        if (!msg.text.startsWith("/") && !["💎 GET CODES 🎁", "🤝 Refer & Earn", "👤 Profile", "📞 Support", "🔥 Daily Code", "📋 Active Codes"].includes(msg.text)) {
          try {
            bot.sendChatAction(msg.chat.id, "typing");
            const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: [{ parts: [{ text: msg.text }] }],
              config: {
                systemInstruction: "You are the 'Top Follow Codes' bot. You help users get free Instagram followers by providing codes for the Top Follow app. You are friendly, energetic, and use emojis. Your messages should be professional and consistent with the bot's UI design (using separators like '_________________________' and bold headers). Use HTML tags for formatting: <b>bold</b>, <i>italic</i>, <code>code</code>. If users ask for codes, give them 'FREE500'. If they ask about the app, explain it helps get followers."
              }
            });
            
            const aiText = response.text || "I'm not sure how to respond to that.";
            bot.sendMessage(msg.chat.id, aiText, { parse_mode: "HTML" });
          } catch (error) {
            console.error("Gemini Error:", error);
            bot.sendMessage(msg.chat.id, "Sorry, I'm having trouble thinking right now. 🤖");
          }
        }
      });

    } catch (error) {
      console.error("Failed to start Telegram bot:", error);
      botStatus = "Error: Invalid Token";
    }
  } else {
    botStatus = "Waiting for Token";
    botName = "";
  }

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/bot-status", (req, res) => {
    res.json({ status: botStatus, name: botName, messages: lastMessages, settings });
  });

  // Admin credentials
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "password123";

  app.post("/api/admin/login", (req, res) => {
    const { username, password } = req.body;
    if (username === adminUsername && password === adminPassword) {
      res.json({ success: true, token: "admin-token-123" });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
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
    settings = { ...settings, ...req.body };
    saveSettings(settings);
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

  app.post("/api/admin/broadcast", checkAdmin, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    let successCount = 0;
    let failCount = 0;

    const userIds = Object.keys(users);
    for (const id of userIds) {
      try {
        if (bot) {
          await bot.sendMessage(id, message, { parse_mode: "HTML" });
          successCount++;
        } else {
          failCount++;
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
