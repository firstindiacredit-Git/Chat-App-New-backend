const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Message = require("../models/Message");
const ChatRoom = require("../models/ChatRoom");
const Group = require("../models/Group");
const Story = require("../models/Story");
const Call = require("../models/Call");

// Store active users
const activeUsers = new Map();

const initializeSocket = (io) => {
  // Authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select("-password");

      if (!user) {
        return next(new Error("Authentication error: User not found"));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      `✅ User connected: ${socket.user.name} (${socket.userId}) - Socket ID: ${socket.id}`
    );
    console.log(`📊 Total active users before: ${activeUsers.size}`);

    // Check if user already has an active connection
    const existingConnection = activeUsers.get(socket.userId);
    if (existingConnection) {
      console.log(
        `⚠️ User ${socket.user.name} already has active connection with Socket ID: ${existingConnection.socketId}`
      );
      console.log(`🔄 Replacing old connection with new one`);

      // Disconnect the old socket if it's still connected
      const oldSocket = io.sockets.sockets.get(existingConnection.socketId);
      if (oldSocket) {
        console.log(
          `🔌 Disconnecting old socket: ${existingConnection.socketId}`
        );
        oldSocket.disconnect(true);
      }
    }

    // Add user to active users
    activeUsers.set(socket.userId, {
      socketId: socket.id,
      user: socket.user,
      lastSeen: new Date(),
    });

    console.log(`📊 Total active users after: ${activeUsers.size}`);
    console.log(
      `👥 Active users: ${Array.from(activeUsers.keys()).join(", ")}`
    );

    // Join user to their personal room
    socket.join(socket.userId);

    // Emit online status to all contacts
    socket.broadcast.emit("user-online", {
      userId: socket.userId,
      user: socket.user,
      socketId: socket.id,
    });

    // Send current online users to the newly connected user
    const onlineUsersList = Array.from(activeUsers.values()).map(
      (userData) => ({
        userId: userData.user._id,
        user: userData.user,
        socketId: userData.socketId,
      })
    );
    socket.emit("online-users", onlineUsersList);

    // Handle sending messages
    socket.on("send-message", async (data) => {
      try {
        console.log("📨 Received send-message event:", data);
        const {
          receiverId,
          content,
          messageType = "text",
          attachment,
          isGroupChat = false,
        } = data;

        if (!receiverId || (!content && !attachment)) {
          console.log("❌ Missing receiverId or content/attachment");
          socket.emit("message-error", {
            error: "Receiver ID and content or attachment are required",
          });
          return;
        }

        if (isGroupChat) {
          // Handle group message
          const group = await Group.findOne({
            _id: receiverId,
            members: socket.userId,
            isActive: true,
          });

          if (!group) {
            socket.emit("message-error", {
              error: "Group not found or you are not a member",
            });
            return;
          }

          // Create group message in database
          const messageData = {
            sender: socket.userId,
            group: receiverId,
            content: content ? content.trim() : "",
            messageType,
          };

          // Add attachment if provided
          if (attachment) {
            messageData.attachment = attachment;
          }

          const message = new Message(messageData);

          await message.save();

          // Populate sender info
          await message.populate("sender", "name email avatar");

          // Update group's last message and activity
          group.lastMessage = message._id;
          group.lastActivity = new Date();
          await group.save();

          // Emit message to sender (confirmation)
          console.log("📤 Emitting message-sent to sender:", socket.userId);
          socket.emit("message-sent", {
            message: message,
            groupId: group._id,
          });

          // Emit new-message to all group members
          console.log("📤 Emitting new-message to all group members");
          group.members.forEach((memberId) => {
            const memberSocket = activeUsers.get(memberId.toString());
            if (memberSocket) {
              io.to(memberSocket.socketId).emit("new-message", {
                message: message,
                groupId: group._id,
                sender: socket.user,
              });
            }
          });

          console.log(
            `Group message sent from ${socket.user.name} to group ${group.name}`
          );
        } else {
          // Handle private message (existing logic)
          const receiver = await User.findById(receiverId);
          if (!receiver) {
            socket.emit("message-error", { error: "Receiver not found" });
            return;
          }

          // Create message in database
          const messageData = {
            sender: socket.userId,
            receiver: receiverId,
            content: content ? content.trim() : "",
            messageType,
          };

          // Add attachment if provided
          if (attachment) {
            messageData.attachment = attachment;
          }

          const message = new Message(messageData);

          await message.save();

          // Populate sender info
          await message.populate("sender", "name email avatar");

          // Check if receiver is currently viewing this chat
          const receiverSocket = activeUsers.get(receiverId);
          const receiverViewingThisChat =
            receiverSocket && receiverSocket.viewingChat === socket.userId;

          // Mark message as read only if receiver is viewing this specific chat
          if (receiverViewingThisChat) {
            console.log(
              `📖 Receiver ${receiver.name} is viewing this chat - marking as read`
            );
            message.isRead = true;
            await message.save();
          } else {
            console.log(
              `📭 Receiver ${receiver.name} is not viewing this chat - keeping as unread`
            );
            message.isRead = false;
            await message.save();
          }

          // Find or create chat room
          let chatRoom = await ChatRoom.findOne({
            participants: { $all: [socket.userId, receiverId] },
            roomType: "private",
          });

          if (!chatRoom) {
            chatRoom = new ChatRoom({
              participants: [socket.userId, receiverId],
              lastMessage: message._id,
              lastActivity: new Date(),
            });
            await chatRoom.save();
          } else {
            chatRoom.lastMessage = message._id;
            chatRoom.lastActivity = new Date();
            await chatRoom.save();
          }

          // Emit message to sender (confirmation)
          console.log("📤 Emitting message-sent to sender:", socket.userId);
          socket.emit("message-sent", {
            message: message,
            chatRoomId: chatRoom._id,
          });

          // Emit new-message to BOTH sender and receiver to update chat lists
          console.log("📤 Emitting new-message to sender:", socket.userId);
          socket.emit("new-message", {
            message: message,
            chatRoomId: chatRoom._id,
            sender: socket.user,
          });

          // Emit message to receiver if online
          if (receiverSocket) {
            console.log("📤 Emitting new-message to receiver:", receiverId);
            io.to(receiverSocket.socketId).emit("new-message", {
              message: message,
              chatRoomId: chatRoom._id,
              sender: socket.user,
            });
          } else {
            console.log("📭 Receiver not online:", receiverId);
          }

          console.log(
            `Message sent from ${socket.user.name} to ${receiver.name}`
          );
        }
      } catch (error) {
        console.error("❌ Send message error:", error);
        console.error("❌ Error details:", {
          message: error.message,
          stack: error.stack,
          name: error.name,
          userId: socket.userId,
          userName: socket.user?.name,
          data: data,
        });
        socket.emit("message-error", {
          error: "Failed to send message",
          details: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle message read status
    socket.on("mark-message-read", async (data) => {
      try {
        const { messageId, senderId } = data;

        if (!messageId || !senderId) {
          return;
        }

        // Update message as read
        await Message.findByIdAndUpdate(messageId, { isRead: true });

        // Notify sender that message was read
        const senderSocket = activeUsers.get(senderId);
        if (senderSocket) {
          io.to(senderSocket.socketId).emit("message-read", {
            messageId,
            readBy: socket.userId,
            readAt: new Date(),
          });
        }
      } catch (error) {
        console.error("Mark message read error:", error);
      }
    });

    // Handle typing indicators
    socket.on("typing-start", (data) => {
      const { receiverId } = data;
      const receiverSocket = activeUsers.get(receiverId);

      if (receiverSocket) {
        io.to(receiverSocket.socketId).emit("user-typing", {
          senderId: socket.userId,
          sender: socket.user,
          isTyping: true,
        });
      }
    });

    socket.on("typing-stop", (data) => {
      const { receiverId } = data;
      const receiverSocket = activeUsers.get(receiverId);

      if (receiverSocket) {
        io.to(receiverSocket.socketId).emit("user-typing", {
          senderId: socket.userId,
          sender: socket.user,
          isTyping: false,
        });
      }
    });

    // Handle call initiation
    socket.on("call-initiate", async (data) => {
      try {
        const { receiverId, callType = "voice" } = data;

        if (!receiverId) {
          socket.emit("call-error", { error: "Receiver ID is required" });
          return;
        }

        // Check if receiver exists
        const receiver = await User.findById(receiverId);
        if (!receiver) {
          socket.emit("call-error", { error: "Receiver not found" });
          return;
        }

        // Check if user is trying to call themselves
        if (socket.userId === receiverId) {
          socket.emit("call-error", { error: "Cannot call yourself" });
          return;
        }

        // Generate a unique room name for Jitsi Meet
        // Use simpler format to avoid membersOnly issues
        const timestamp = Date.now().toString().slice(-8); // Last 8 digits
        const random = Math.random().toString(36).substr(2, 6); // 6 random chars
        const roomName = `call-${timestamp}-${random}`;

        // Create new call record
        const call = new Call({
          caller: socket.userId,
          receiver: receiverId,
          callType,
          status: "initiated",
          roomName: roomName, // Store the Jitsi room name
        });

        await call.save();

        // Emit call initiation to caller (confirmation)
        socket.emit("call-initiated", {
          callId: call._id,
          callType: call.callType,
          status: call.status,
          receiver: receiver,
          roomName: roomName,
        });

        // Emit incoming call to receiver if online
        const receiverSocket = activeUsers.get(receiverId);
        if (receiverSocket) {
          io.to(receiverSocket.socketId).emit("incoming-call", {
            callId: call._id,
            caller: socket.user,
            callType: call.callType,
            roomName: roomName,
          });
        } else {
          // Receiver is offline, mark call as missed
          await call.markAsMissed();
          socket.emit("call-missed", {
            callId: call._id,
            reason: "Receiver is offline",
          });
        }

        console.log(
          `📞 Call initiated from ${socket.user.name} to ${receiver.name}`
        );
      } catch (error) {
        console.error("Call initiation error:", error);
        socket.emit("call-error", { error: "Failed to initiate call" });
      }
    });

    // Handle call answer
    socket.on("call-answer", async (data) => {
      try {
        const { callId, answer } = data;

        const call = await Call.findById(callId);
        if (!call) {
          socket.emit("call-error", { error: "Call not found" });
          return;
        }

        // Check if user is the receiver
        if (call.receiver.toString() !== socket.userId) {
          socket.emit("call-error", {
            error: "Not authorized to answer this call",
          });
          return;
        }

        // Update call status and answer
        call.status = "answered";
        if (answer) {
          call.answer = JSON.stringify(answer);
        }
        await call.save();

        // Emit call answered to caller
        const callerSocket = activeUsers.get(call.caller.toString());
        if (callerSocket) {
          console.log(
            `📞 Sending call-answered to caller: ${callerSocket.user.name} for call: ${call._id}`
          );
          io.to(callerSocket.socketId).emit("call-answered", {
            callId: call._id,
            status: call.status,
            answer: answer, // Send the original answer object, not the stringified version
            receiver: socket.user,
          });
        } else {
          console.log(`📞 Caller socket not found for call: ${call._id}`);
        }

        console.log(`📞 Call answered by ${socket.user.name}`);
      } catch (error) {
        console.error("Call answer error:", error);
        socket.emit("call-error", { error: "Failed to answer call" });
      }
    });

    // Handle call decline
    socket.on("call-decline", async (data) => {
      try {
        const { callId } = data;

        const call = await Call.findById(callId);
        if (!call) {
          socket.emit("call-error", { error: "Call not found" });
          return;
        }

        // Check if user is the receiver
        if (call.receiver.toString() !== socket.userId) {
          socket.emit("call-error", {
            error: "Not authorized to decline this call",
          });
          return;
        }

        // Mark call as declined
        await call.markAsDeclined();

        // Emit call declined to receiver (confirmation)
        socket.emit("call-declined", {
          callId: call._id,
          status: call.status,
        });

        // Emit call declined to caller
        const callerSocket = activeUsers.get(call.caller.toString());
        if (callerSocket) {
          io.to(callerSocket.socketId).emit("call-declined", {
            callId: call._id,
            status: call.status,
            receiver: socket.user,
          });
        }

        console.log(`📞 Call declined by ${socket.user.name}`);
      } catch (error) {
        console.error("Call decline error:", error);
        socket.emit("call-error", { error: "Failed to decline call" });
      }
    });

    // Handle call end
    socket.on("call-end", async (data) => {
      try {
        const { callId } = data;

        const call = await Call.findById(callId);
        if (!call) {
          socket.emit("call-error", { error: "Call not found" });
          return;
        }

        // Check if user is either caller or receiver
        if (
          call.caller.toString() !== socket.userId &&
          call.receiver.toString() !== socket.userId
        ) {
          socket.emit("call-error", {
            error: "Not authorized to end this call",
          });
          return;
        }

        // End the call
        await call.endCall();

        // Emit call ended to both parties
        socket.emit("call-ended", {
          callId: call._id,
          status: call.status,
          duration: call.duration,
        });

        // Emit to the other party
        const otherUserId =
          call.caller.toString() === socket.userId
            ? call.receiver.toString()
            : call.caller.toString();
        const otherUserSocket = activeUsers.get(otherUserId);
        if (otherUserSocket) {
          io.to(otherUserSocket.socketId).emit("call-ended", {
            callId: call._id,
            status: call.status,
            duration: call.duration,
            endedBy: socket.user,
          });
        }

        console.log(
          `📞 Call ended by ${socket.user.name}, duration: ${call.duration}s`
        );
      } catch (error) {
        console.error("Call end error:", error);
        socket.emit("call-error", { error: "Failed to end call" });
      }
    });

    // Handle call offer
    socket.on("call-offer", async (data) => {
      try {
        console.log("📞 Received call-offer event:", data);
        const { callId, offer } = data;

        if (!callId) {
          socket.emit("call-error", { error: "Call ID is required" });
          return;
        }

        if (!offer) {
          socket.emit("call-error", { error: "Offer is required" });
          return;
        }

        const call = await Call.findById(callId);
        if (!call) {
          console.error(`❌ Call not found: ${callId}`);
          socket.emit("call-error", { error: "Call not found" });
          return;
        }

        // Check if user is the caller
        if (call.caller.toString() !== socket.userId) {
          console.error(
            `❌ Unauthorized: User ${socket.userId} is not the caller of call ${callId}`
          );
          socket.emit("call-error", { error: "Not authorized to send offer" });
          return;
        }

        // Update call with offer (convert to string for database storage)
        call.offer = JSON.stringify(offer);
        await call.save();
        console.log(`✅ Call offer saved to database for call ${callId}`);

        // Forward offer to receiver
        const receiverSocket = activeUsers.get(call.receiver.toString());
        if (receiverSocket) {
          io.to(receiverSocket.socketId).emit("call-offer", {
            callId: call._id,
            offer: offer,
            from: socket.user,
          });
          console.log(`📞 Call offer forwarded to receiver ${call.receiver}`);
        } else {
          console.log(`⚠️ Receiver ${call.receiver} is not online`);
        }

        console.log(
          `📞 Call offer sent from ${socket.user.name} for call ${callId}`
        );
      } catch (error) {
        console.error("Call offer error:", error);
        socket.emit("call-error", { error: "Failed to send call offer" });
      }
    });

    // Handle ICE candidate exchange
    socket.on("ice-candidate", async (data) => {
      try {
        const { callId, candidate, sdpMLineIndex, sdpMid } = data;

        const call = await Call.findById(callId);
        if (!call) {
          socket.emit("call-error", { error: "Call not found" });
          return;
        }

        // Check if user is either caller or receiver
        if (
          call.caller.toString() !== socket.userId &&
          call.receiver.toString() !== socket.userId
        ) {
          socket.emit("call-error", {
            error: "Not authorized to send ICE candidate",
          });
          return;
        }

        // Add ICE candidate to call record
        call.iceCandidates.push({
          candidate,
          sdpMLineIndex,
          sdpMid,
        });
        await call.save();

        // Forward ICE candidate to the other party
        const otherUserId =
          call.caller.toString() === socket.userId
            ? call.receiver.toString()
            : call.caller.toString();
        const otherUserSocket = activeUsers.get(otherUserId);
        if (otherUserSocket) {
          io.to(otherUserSocket.socketId).emit("ice-candidate", {
            callId: call._id,
            candidate,
            sdpMLineIndex,
            sdpMid,
            from: socket.user,
          });
        }

        console.log(
          `🧊 ICE candidate sent from ${socket.user.name} for call ${callId}`
        );
      } catch (error) {
        console.error("ICE candidate error:", error);
        socket.emit("call-error", { error: "Failed to send ICE candidate" });
      }
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      console.log(
        `❌ User disconnected: ${socket.user.name} (${socket.userId}) - Socket ID: ${socket.id} - Reason: ${reason}`
      );
      console.log(
        `📊 Total active users before disconnect: ${activeUsers.size}`
      );

      // Remove from active users
      activeUsers.delete(socket.userId);

      console.log(
        `📊 Total active users after disconnect: ${activeUsers.size}`
      );
      console.log(
        `👥 Remaining active users: ${Array.from(activeUsers.keys()).join(
          ", "
        )}`
      );

      // Emit offline status to all contacts
      socket.broadcast.emit("user-offline", {
        userId: socket.userId,
        user: socket.user,
        reason: reason,
      });
    });

    // Handle user viewing chat status
    socket.on("user-viewing-chat", async (data) => {
      const { chatUserId, isViewing } = data;

      if (isViewing && chatUserId) {
        // User is viewing a specific chat
        console.log(
          `👁️ User ${socket.user.name} is viewing chat with user: ${chatUserId}`
        );

        // Update the activeUsers map to track which chat this user is viewing
        const userData = activeUsers.get(socket.userId);
        if (userData) {
          userData.viewingChat = chatUserId;
          activeUsers.set(socket.userId, userData);
        }

        // Notify the other user that this user is viewing their chat
        const otherUserSocket = activeUsers.get(chatUserId);
        if (otherUserSocket) {
          io.to(otherUserSocket.socketId).emit("user-viewing-status", {
            viewerId: socket.userId,
            viewer: socket.user,
            isViewing: true,
            chatUserId: chatUserId,
          });
        }

        // Mark all unread messages from this sender as read when they start viewing
        try {
          const Message = require("../models/Message");
          const result = await Message.updateMany(
            {
              sender: chatUserId,
              receiver: socket.userId,
              isRead: false,
            },
            { isRead: true }
          );

          if (result.modifiedCount > 0) {
            console.log(
              `📖 Marked ${result.modifiedCount} messages as read for ${socket.user.name} viewing chat`
            );

            // Notify the sender (chatUserId) that their messages were marked as read
            // Find the sender's socket and notify them
            const senderSocket = activeUsers.get(chatUserId);
            if (senderSocket) {
              io.to(senderSocket.socketId).emit("messages-marked-read", {
                senderId: chatUserId,
                receiverId: socket.userId,
                count: result.modifiedCount,
              });
            }
          }
        } catch (error) {
          console.error("Error marking messages as read:", error);
        }
      } else {
        // User stopped viewing the chat
        console.log(`👁️ User ${socket.user.name} stopped viewing chat`);

        // Update the activeUsers map to remove viewing chat
        const userData = activeUsers.get(socket.userId);
        if (userData) {
          userData.viewingChat = null;
          activeUsers.set(socket.userId, userData);
        }

        // Notify all users that this user is no longer viewing their chat
        socket.broadcast.emit("user-viewing-status", {
          viewerId: socket.userId,
          viewer: socket.user,
          isViewing: false,
          chatUserId: null,
        });
      }
    });

    // Handle story creation
    socket.on("story-created", async (data) => {
      try {
        console.log("📸 Story created event received:", data);

        // Broadcast to all users that a new story was created
        socket.broadcast.emit("new-story", {
          story: data.story,
          author: socket.user,
        });

        console.log(
          `📸 Story created by ${socket.user.name} broadcasted to all users`
        );
      } catch (error) {
        console.error("Story created broadcast error:", error);
      }
    });

    // Handle story view
    socket.on("story-viewed", async (data) => {
      try {
        const { storyId, authorId } = data;

        if (!storyId || !authorId) {
          return;
        }

        // Notify the story author that their story was viewed
        const authorSocket = activeUsers.get(authorId);
        if (authorSocket) {
          io.to(authorSocket.socketId).emit("story-viewed-notification", {
            storyId,
            viewer: socket.user,
            viewedAt: new Date(),
          });
        }

        console.log(
          `👁️ Story ${storyId} viewed by ${socket.user.name}, notified author`
        );
      } catch (error) {
        console.error("Story viewed notification error:", error);
      }
    });

    // Handle story deletion
    socket.on("story-deleted", async (data) => {
      try {
        const { storyId } = data;

        // Broadcast to all users that a story was deleted
        socket.broadcast.emit("story-deleted", {
          storyId,
          author: socket.user,
        });

        console.log(`🗑️ Story ${storyId} deleted by ${socket.user.name}`);
      } catch (error) {
        console.error("Story deleted broadcast error:", error);
      }
    });

    // Handle connection errors
    socket.on("error", (error) => {
      console.error(`Socket error for user ${socket.user.name}:`, error);
    });
  });

  return io;
};

// Get active users
const getActiveUsers = () => {
  return Array.from(activeUsers.values()).map((user) => ({
    userId: user.user._id,
    user: user.user,
    lastSeen: user.lastSeen,
    isOnline: true,
  }));
};

// Check if user is online
const isUserOnline = (userId) => {
  return activeUsers.has(userId);
};

module.exports = {
  initializeSocket,
  getActiveUsers,
  isUserOnline,
};
