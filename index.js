require("dotenv/config");
const express = require("express");
const mongoose = require("mongoose");
const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { computeCheck } = require("telegram/Password");
const cors = require("cors");
const path = require("path");
const User = require("./models/userModel");
const { Telegraf } = require("telegraf");
const Queue = require("queue-promise");
const setName = require("./helpers/setName");
const fetchChatList = require("./helpers/fetchChatList");
const isSessionValid = require("./helpers/isSessionValid");

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Queue configuration for bot commands
const queue = new Queue({
  concurrent: 30,
  interval: 1000,
});

// Initialize Telegram client
const client = new TelegramClient(
  new StringSession(""),
  Number(process.env.API_ID),
  process.env.API_HASH,
  {
    connectionRetries: 5,
  }
);

// Middleware setup
app.use(express.json());
app.use(cors({ origin: "*" }));

// MongoDB connection
mongoose
  .connect(process.env.URI, { dbName: "tg_user_db" })
  .then(() => console.log("MongoDB connected"))
  .catch((error) => console.error("MongoDB connection error:", error));

// Start command handler for the bot
bot.start(async (ctx) => {
  queue.enqueue(async () => {
    try {
      const message = `Hello, *${setName(
        ctx.from
      )}*!👋\n\nClick the button below to login and see your chat history😁`;
      await ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Click to login",
                web_app: {
                  url: process.env.WEB_APP_URL,
                },
              },
            ],
          ],
        },
      });
    } catch (error) {
      console.error("Error sending start message:", error);
      await ctx.reply("An error occurred while sending the message.");
    }
  });
});

// Send code for login
app.post("/api/send-code", async (req, res) => {
  const { phone_number } = req.body;

  try {
    await client.connect();

    // //Check if user's session exists, and fetch chats instead, to prevent redundant login
    // const userData = await User.findOne({ phone_number });
    // if (userData && userData.session) {
    //   const userSessionIsValid = isSessionValid(userData);
    //   if (userSessionIsValid) {
    //     return await fetchChatList(client, userData, res);
    //   }
    // }

    const { phoneCodeHash } = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: `${phone_number}`,
        apiId: parseInt(process.env.API_ID),
        apiHash: `${process.env.API_HASH}`,
        settings: new Api.CodeSettings({
          allowFlashcall: true,
          currentNumber: true,
          allowAppHash: true,
          allowMissedCall: true,
          logoutTokens: [Buffer.from("arbitrary data here")],
        }),
      })
    );

    res.json({
      success: true,
      message: "Code sent! Check your phone.",
      phone_code_hash: phoneCodeHash,
    });
  } catch (error) {
    console.error("Error sending code:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", async (req, res) => {
  res.send("Hello");
});

// Sign-in and save session
app.post("/api/sign-in", async (req, res) => {
  const { phone_number, phone_code, phone_code_hash, password } = req.body;

  try {
    await client.connect();

    let result;
    try {
      // Attempt to sign in using the code
      result = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: `${phone_number}`,
          phoneCodeHash: phone_code_hash,
          phoneCode: phone_code,
        })
      );
    } catch (error) {
      if (
        error.code === 401 &&
        error.errorMessage.includes("SESSION_PASSWORD_NEEDED")
      ) {
        // If a password is needed, retrieve the password requirements
        const passwordInfo = await client.invoke(new Api.account.GetPassword());

        // Hash the password using the salt from `GetPassword`
        const passwordHashResult = await computeCheck(
          passwordInfo, // password requirements from Telegram
          password // user-supplied plain text password
        );

        // Complete login using `CheckPassword` with the hashed password
        result = await client.invoke(
          new Api.auth.CheckPassword({
            password: passwordHashResult,
          })
        );
      } else {
        throw error; // Re-throw if it's not a password-related error
      }
    }

    // Save the session in MongoDB
    const dbUser = await User.findOneAndUpdate(
      { phone_number },
      { session: client.session.save() },
      { new: true, upsert: true }
    );

    res.json({ success: true, user: dbUser });
  } catch (error) {
    console.error("Error signing in:", error);
    res.status(500).json({ error: error.message });
  }
});

// Retrieve chat list
app.get("/api/chats/:phone_number", async (req, res) => {
  const { phone_number } = req.params;

  try {
    const user = await User.findOne({ phone_number });
    if (!user) return res.status(404).json({ error: "User not found" });

    await fetchChatList(client, user, res);
  } catch (error) {
    console.error("Error retrieving chats:", error);
    res.status(500).json({ error: error.message });
  }
});

// Retrieve messages for a specific chat
app.post("/api/messages", async (req, res) => {
  const { phone_number, chat_id } = req.body;

  try {
    const user = await User.findOne({ phone_number });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Load user session
    client.session = new StringSession(user.session);
    client.connect();

    // Fetch chat details to get participants
    const chat = await client.getEntity(chat_id);
    const participants = await client.getParticipants(chat_id);

    // Find chatmate (exclude self)
    const chatmate = participants.find(
      (participant) => participant.id !== user.id
    );
    const chatmateName =
      chatmate.firstName || chatmate.lastName || chatmate.username || "No name"; // Fallback if none exist

    // Get messages from the chat
    const messages = await client.getMessages(chat_id, { limit: 50 });
    // Sort messages by date (ascending) if not already sorted
    const sortedMessages = messages.sort((a, b) => a.date - b.date);

    const sanitizedMessages = sortedMessages.map((message) => {
      // Check if the message is text or another type
      const messageType = message.message ? "text" : "media";
      const content =
        message.message || (message.media ? "Media" : "Unknown type");

      return {
        id: message.id,
        date: message.date,
        content, // Display text or placeholder like "Image", "Audio", etc.
        messageType, // "text" or "media"
        senderType: message.out ? "sent" : "received",
      };
    });

    res.status(200).json({
      success: true,
      data: { chatmateName, messages: sanitizedMessages },
    });
  } catch (error) {
    console.error("Error retrieving messages:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Bot launch and connection log
bot.telegram
  .getMe()
  .then((botInfo) => {
    console.log(`Bot ${botInfo.username} is connected and running.`);
    bot.launch();
  })
  .catch((err) => {
    console.error("Error connecting bot:", err);
  });
