const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Message = require("../models/Message");
const ChatRoom = require("../models/ChatRoom");
const Group = require("../models/Group");
const Story = require("../models/Story");
const Call = require("../models/Call");
const notificationService = require("../services/notificationService");

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

        // Check blocking status before sending message (only for private messages)
        if (!isGroupChat) {
          const sender = await User.findById(socket.userId);
          const receiver = await User.findById(receiverId);

          if (!receiver) {
            socket.emit("message-error", {
              error: "Receiver not found",
            });
            return;
          }

          // Check if sender has blocked receiver OR receiver has blocked sender (mutual blocking)
          const senderBlockedReceiver =
            sender.blockedUsers && sender.blockedUsers.includes(receiverId);
          const receiverBlockedSender =
            receiver.blockedUsers &&
            receiver.blockedUsers.includes(socket.userId);

          if (senderBlockedReceiver || receiverBlockedSender) {
            console.log("🚫 Message blocked - users have blocked each other");
            socket.emit("message-error", {
              error: "Cannot send message. User is blocked.",
            });
            return;
          }
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

          // Populate sender info and reactions
          await message.populate("sender", "name email avatar");
          await message.populate("reactions.user", "name avatar");

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
          const offlineMembers = [];
          
          group.members.forEach((memberId) => {
            const memberSocket = activeUsers.get(memberId.toString());
            if (memberSocket) {
              io.to(memberSocket.socketId).emit("new-message", {
                message: message,
                groupId: group._id,
                sender: socket.user,
              });
            } else if (memberId.toString() !== socket.userId) {
              // Track offline members (excluding sender)
              offlineMembers.push(memberId.toString());
            }
          });

          // Send push notifications to offline group members
          if (offlineMembers.length > 0) {
            console.log(`📱 Sending push notifications to ${offlineMembers.length} offline group members`);
            try {
              const groupNotificationPayload = {
                title: `${group.name}`,
                body: `${socket.user.name}: ${message.content || 'New message'}`,
                icon: '/vite.svg',
                tag: `group-${group._id}`,
                data: {
                  type: 'message',
                  chatId: group._id.toString(),
                  groupId: group._id.toString(),
                  senderName: socket.user.name,
                  groupName: group.name,
                  timestamp: Date.now()
                }
              };

              for (const memberId of offlineMembers) {
                await notificationService.sendNotificationToUser(memberId, groupNotificationPayload);
              }
              console.log(`📱 Push notifications sent to offline group members`);
            } catch (error) {
              console.error('📱 Failed to send group push notifications:', error);
            }
          }

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

          // Check if users are friends before allowing message
          const sender = await User.findById(socket.userId);
          const areFriends =
            sender.friends && sender.friends.includes(receiverId);

          if (!areFriends) {
            socket.emit("message-error", {
              error:
                "You can only send messages to friends. Send a friend request first.",
            });
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

          // Populate sender info and reactions
          await message.populate("sender", "name email avatar");
          await message.populate("reactions.user", "name avatar");

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
              deletedFor: [], // Initialize empty deletedFor array
            });
            await chatRoom.save();
          } else {
            // If chat was deleted by either user, restore it for them when new message is sent
            if (chatRoom.deletedFor && chatRoom.deletedFor.length > 0) {
              chatRoom.deletedFor = chatRoom.deletedFor.filter(
                (userId) =>
                  userId.toString() !== socket.userId &&
                  userId.toString() !== receiverId
              );
            }

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
            console.log("📭 Receiver not online - sending push notification:", receiverId);
            
            // Send push notification to offline user
            try {
              await notificationService.sendMessageNotification(
                receiverId,
                socket.user.name,
                message.content || 'New message',
                chatRoom._id.toString()
              );
              console.log(`📱 Push notification sent to ${receiver.name}`);
            } catch (error) {
              console.error('📱 Failed to send push notification:', error);
            }
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

    // Handle WebRTC answer (separate from call answer)
    socket.on("call-answer-webrtc", async (data) => {
      try {
        console.log("📞 Received call-answer-webrtc event:", data);
        const { callId, answer } = data;

        if (!callId || !answer) {
          socket.emit("call-error", {
            error: "Call ID and answer are required",
          });
          return;
        }

        const call = await Call.findById(callId);
        if (!call) {
          socket.emit("call-error", { error: "Call not found" });
          return;
        }

        // Check if user is the receiver
        if (call.receiver.toString() !== socket.userId) {
          socket.emit("call-error", { error: "Not authorized to send answer" });
          return;
        }

        // Update call with answer
        call.answer = JSON.stringify(answer);
        await call.save();

        // Forward answer to caller
        const callerSocket = activeUsers.get(call.caller.toString());
        if (callerSocket) {
          io.to(callerSocket.socketId).emit("call-answer-webrtc", {
            callId: call._id,
            answer: answer,
            from: socket.user,
          });
          console.log(`📞 WebRTC answer forwarded to caller ${call.caller}`);
        }

        console.log(
          `📞 WebRTC answer sent from ${socket.user.name} for call ${callId}`
        );
      } catch (error) {
        console.error("WebRTC answer error:", error);
        socket.emit("call-error", { error: "Failed to send answer" });
      }
    });

    // Handle ICE candidate exchange
    socket.on("ice-candidate", async (data) => {
      try {
        console.log("🧊 Received ICE candidate event:", data);
        const { callId, candidate, sdpMLineIndex, sdpMid } = data;

        if (!callId) {
          console.log("❌ No call ID in ICE candidate");
          socket.emit("call-error", {
            error: "Call ID is required for ICE candidate",
          });
          return;
        }

        if (!candidate) {
          console.log("❌ No candidate in ICE candidate");
          socket.emit("call-error", { error: "ICE candidate is required" });
          return;
        }

        const call = await Call.findById(callId);
        if (!call) {
          console.log(`❌ Call not found for ICE candidate: ${callId}`);
          socket.emit("call-error", { error: "Call not found" });
          return;
        }

        // Check if user is either caller or receiver
        if (
          call.caller.toString() !== socket.userId &&
          call.receiver.toString() !== socket.userId
        ) {
          console.log(
            `❌ Unauthorized ICE candidate from ${socket.userId} for call ${callId}`
          );
          socket.emit("call-error", {
            error: "Not authorized to send ICE candidate",
          });
          return;
        }

        // Add ICE candidate to call record (optional - for debugging)
        try {
          call.iceCandidates.push({
            candidate,
            sdpMLineIndex,
            sdpMid,
          });
          await call.save();
          console.log(`✅ ICE candidate saved to database for call ${callId}`);
        } catch (saveError) {
          console.log(
            `⚠️ Failed to save ICE candidate to database:`,
            saveError
          );
          // Continue anyway - database save is not critical for WebRTC
        }

        // Forward ICE candidate to the other party (this is the important part)
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
          console.log(`🧊 ICE candidate forwarded to ${otherUserId}`);
        } else {
          console.log(
            `⚠️ Other user ${otherUserId} not online for ICE candidate`
          );
        }

        console.log(
          `🧊 ICE candidate processed from ${socket.user.name} for call ${callId}`
        );
      } catch (error) {
        console.error("ICE candidate error:", error);
        socket.emit("call-error", {
          error: "Failed to send ICE candidate",
          details: error.message,
        });
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

    // Handle message deletion
    socket.on("delete-message", async (data) => {
      try {
        const { messageId } = data;

        console.log(`🗑️ Delete message request from ${socket.user.name}:`, {
          messageId,
          userId: socket.userId,
          userName: socket.user.name,
          userIdType: typeof socket.userId,
          messageIdType: typeof messageId,
        });

        if (!messageId) {
          console.log("❌ No message ID provided");
          socket.emit("message-error", { error: "Message ID is required" });
          return;
        }

        if (!socket.userId) {
          console.log("❌ No user ID available");
          socket.emit("message-error", { error: "User not authenticated" });
          return;
        }

        // First, let's try to find the message without any restrictions to debug
        let messageExists;
        try {
          messageExists = await Message.findById(messageId);
          console.log(`🔍 Message exists check:`, {
            messageId,
            exists: !!messageExists,
            sender: messageExists?.sender?.toString(),
            currentUser: socket.userId,
            isDeleted: messageExists?.isDeleted,
          });
        } catch (findError) {
          console.log("❌ Error finding message by ID:", findError);
          socket.emit("message-error", {
            error: "Invalid message ID",
          });
          return;
        }

        // Try to find message with proper ObjectId handling
        let message;
        try {
          message = await Message.findOne({
            _id: messageId,
            sender: socket.userId,
            isDeleted: false,
          });
        } catch (dbError) {
          console.log("❌ Database query error:", dbError);
          socket.emit("message-error", {
            error: "Invalid message ID format",
          });
          return;
        }

        if (!message) {
          // More detailed debugging for authorization issues
          if (messageExists) {
            const messageSenderStr = messageExists.sender?.toString();
            const currentUserStr = socket.userId?.toString();
            console.log(`❌ Authorization failed - detailed comparison:`, {
              messageId,
              messageExists: true,
              messageSender: messageSenderStr,
              currentUser: currentUserStr,
              sendersMatch: messageSenderStr === currentUserStr,
              messageDeleted: messageExists.isDeleted,
              messageContent: messageExists.content?.substring(0, 50),
              messageType: messageExists.messageType,
            });

            // Try alternative approach - manual authorization check
            if (
              messageSenderStr === currentUserStr &&
              !messageExists.isDeleted
            ) {
              console.log(
                "🔄 Manual authorization passed, using messageExists as message"
              );
              message = messageExists;
            }
          }

          if (!message) {
            console.log(`❌ Final check - Message not found or unauthorized:`, {
              messageId,
              requestedBy: socket.userId,
              messageExists: !!messageExists,
              messageSender: messageExists?.sender?.toString(),
              messageDeleted: messageExists?.isDeleted,
            });
            socket.emit("message-error", {
              error: "Message not found or unauthorized",
            });
            return;
          }
        }

        // Mark message as deleted
        message.isDeleted = true;
        message.deletedAt = new Date();
        message.deletedBy = socket.userId;
        message.content = "This message was deleted";
        message.messageType = "deleted";
        await message.save();

        // Populate message info
        await message.populate("sender", "name email avatar");
        await message.populate("reactions.user", "name avatar");
        await message.populate("deletedBy", "name avatar");
        if (message.receiver) {
          await message.populate("receiver", "name email avatar");
        }
        if (message.group) {
          await message.populate("group", "name");
        }

        // Emit deletion confirmation to sender
        socket.emit("message-deleted", {
          messageId: message._id,
          deletedMessage: message,
        });

        // Handle group message deletion
        if (message.group) {
          const group = await Group.findById(message.group._id);
          if (group) {
            // Emit to all group members
            group.members.forEach((memberId) => {
              const memberSocket = activeUsers.get(memberId.toString());
              if (memberSocket && memberId.toString() !== socket.userId) {
                io.to(memberSocket.socketId).emit("message-deleted", {
                  messageId: message._id,
                  deletedMessage: message,
                  groupId: group._id,
                });
              }
            });
          }
        } else if (message.receiver) {
          // Emit to receiver for private message
          const receiverSocket = activeUsers.get(
            message.receiver._id.toString()
          );
          if (receiverSocket) {
            io.to(receiverSocket.socketId).emit("message-deleted", {
              messageId: message._id,
              deletedMessage: message,
            });
          }
        }

        console.log(
          `🗑️ Message deleted successfully by ${socket.user.name}: ${messageId}`
        );
      } catch (error) {
        console.error("Delete message error:", error);
        socket.emit("message-error", {
          error: "Failed to delete message",
          details: error.message,
        });
      }
    });

    // Handle message reactions
    socket.on("add-reaction", async (data) => {
      try {
        const { messageId, reaction = "👍" } = data;

        if (!messageId) {
          socket.emit("message-error", { error: "Message ID is required" });
          return;
        }

        // Validate reaction
        const validReactions = ["👍", "❤️", "😂", "😮", "😢", "😡", "👎"];
        if (!validReactions.includes(reaction)) {
          socket.emit("message-error", { error: "Invalid reaction" });
          return;
        }

        const message = await Message.findOne({
          _id: messageId,
          isDeleted: false,
        });

        if (!message) {
          socket.emit("message-error", { error: "Message not found" });
          return;
        }

        // Check if user already reacted
        const existingReactionIndex = message.reactions.findIndex(
          (r) => r.user.toString() === socket.userId
        );

        if (existingReactionIndex !== -1) {
          // Update existing reaction
          message.reactions[existingReactionIndex].reaction = reaction;
          message.reactions[existingReactionIndex].timestamp = new Date();
        } else {
          // Add new reaction
          message.reactions.push({
            user: socket.userId,
            reaction: reaction,
            timestamp: new Date(),
          });
        }

        await message.save();

        // Populate reaction user info
        await message.populate("reactions.user", "name avatar");
        await message.populate("sender", "name email avatar");
        if (message.receiver) {
          await message.populate("receiver", "name email avatar");
        }
        if (message.group) {
          await message.populate("group", "name");
        }

        // Emit reaction to sender (confirmation)
        socket.emit("reaction-added", {
          messageId: message._id,
          reactions: message.reactions,
          updatedMessage: message,
        });

        // Handle group message reactions
        if (message.group) {
          const group = await Group.findById(message.group._id);
          if (group) {
            // Emit to all group members except sender
            group.members.forEach((memberId) => {
              const memberSocket = activeUsers.get(memberId.toString());
              if (memberSocket && memberId.toString() !== socket.userId) {
                io.to(memberSocket.socketId).emit("reaction-added", {
                  messageId: message._id,
                  reactions: message.reactions,
                  updatedMessage: message,
                  groupId: group._id,
                });
              }
            });
          }
        } else if (message.receiver) {
          // Emit to receiver for private message
          const receiverSocket = activeUsers.get(
            message.receiver._id.toString()
          );
          if (receiverSocket) {
            io.to(receiverSocket.socketId).emit("reaction-added", {
              messageId: message._id,
              reactions: message.reactions,
              updatedMessage: message,
            });
          }
        }

        console.log(
          `👍 Reaction ${reaction} added by ${socket.user.name} to message ${messageId}`
        );
      } catch (error) {
        console.error("Add reaction error:", error);
        socket.emit("message-error", {
          error: "Failed to add reaction",
          details: error.message,
        });
      }
    });

    // Handle removing message reactions
    socket.on("remove-reaction", async (data) => {
      try {
        const { messageId } = data;

        if (!messageId) {
          socket.emit("message-error", { error: "Message ID is required" });
          return;
        }

        const message = await Message.findOne({
          _id: messageId,
          isDeleted: false,
        });

        if (!message) {
          socket.emit("message-error", { error: "Message not found" });
          return;
        }

        // Remove user's reaction
        message.reactions = message.reactions.filter(
          (r) => r.user.toString() !== socket.userId
        );

        await message.save();

        // Populate reaction user info
        await message.populate("reactions.user", "name avatar");
        await message.populate("sender", "name email avatar");
        if (message.receiver) {
          await message.populate("receiver", "name email avatar");
        }
        if (message.group) {
          await message.populate("group", "name");
        }

        // Emit reaction removal to sender (confirmation)
        socket.emit("reaction-removed", {
          messageId: message._id,
          reactions: message.reactions,
          updatedMessage: message,
        });

        // Handle group message reaction removal
        if (message.group) {
          const group = await Group.findById(message.group._id);
          if (group) {
            // Emit to all group members except sender
            group.members.forEach((memberId) => {
              const memberSocket = activeUsers.get(memberId.toString());
              if (memberSocket && memberId.toString() !== socket.userId) {
                io.to(memberSocket.socketId).emit("reaction-removed", {
                  messageId: message._id,
                  reactions: message.reactions,
                  updatedMessage: message,
                  groupId: group._id,
                });
              }
            });
          }
        } else if (message.receiver) {
          // Emit to receiver for private message
          const receiverSocket = activeUsers.get(
            message.receiver._id.toString()
          );
          if (receiverSocket) {
            io.to(receiverSocket.socketId).emit("reaction-removed", {
              messageId: message._id,
              reactions: message.reactions,
              updatedMessage: message,
            });
          }
        }

        console.log(
          `👍 Reaction removed by ${socket.user.name} from message ${messageId}`
        );
      } catch (error) {
        console.error("Remove reaction error:", error);
        socket.emit("message-error", {
          error: "Failed to remove reaction",
          details: error.message,
        });
      }
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
