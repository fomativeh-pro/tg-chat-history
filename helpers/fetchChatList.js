const { StringSession } = require("telegram/sessions");
module.exports = async function fetchChatList(client, user, res) {
  // Load user session
  client.session = new StringSession(user.session);
  await client.connect();

  // Get user's chats
  const dialogs = await client.getDialogs();

  // Map out only essential data to avoid circular structure issues
  const sanitizedChats = dialogs.map((dialog) => ({
    id: dialog.id,
    name: dialog.title,
    unreadCount: dialog.unreadCount,
    isChannel: dialog.isChannel,
    isGroup: dialog.isGroup,
    isUser: dialog.isUser,
    // Add other necessary fields here
  }));

  res.status(200).json({ success: true, data: sanitizedChats, messages:true });
};
