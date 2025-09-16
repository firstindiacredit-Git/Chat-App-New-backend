// Comprehensive Socket Functionality Test
const io = require("socket.io-client");

console.log("🧪 Testing Complete Socket Functionality...\n");

// Test Configuration
const BACKEND_URL = "http://localhost:3000";
const TEST_TOKENS = {
  user1:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NzhmYjQ4YzQ4YzQ4YzQ4YzQ4YzQ4YzQiLCJpYXQiOjE3MzQ5NjQ4MDAsImV4cCI6MTczNDk2ODQwMH0.test1",
  user2:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NzhmYjQ4YzQ4YzQ4YzQ4YzQ4YzQ4YzUiLCJpYXQiOjE3MzQ5NjQ4MDAsImV4cCI6MTczNDk2ODQwMH0.test2",
};

let socket1, socket2;
let testResults = {
  connection: false,
  messageSending: false,
  messageReceiving: false,
  onlineStatus: false,
  typingIndicators: false,
  readReceipts: false,
};

// Test 1: Socket Connection
console.log("1️⃣ Testing Socket Connection...");
function testConnection() {
  return new Promise((resolve) => {
    socket1 = io(BACKEND_URL, {
      auth: { token: TEST_TOKENS.user1 },
      transports: ["websocket", "polling"],
    });

    socket2 = io(BACKEND_URL, {
      auth: { token: TEST_TOKENS.user2 },
      transports: ["websocket", "polling"],
    });

    let connectedCount = 0;
    const checkConnection = () => {
      connectedCount++;
      if (connectedCount === 2) {
        testResults.connection = true;
        console.log("✅ Both sockets connected successfully");
        resolve();
      }
    };

    socket1.on("connect", () => {
      console.log("✅ Socket 1 connected:", socket1.id);
      checkConnection();
    });

    socket2.on("connect", () => {
      console.log("✅ Socket 2 connected:", socket2.id);
      checkConnection();
    });

    socket1.on("connect_error", (error) => {
      console.log("❌ Socket 1 connection error:", error.message);
    });

    socket2.on("connect_error", (error) => {
      console.log("❌ Socket 2 connection error:", error.message);
    });
  });
}

// Test 2: Message Sending/Receiving
function testMessageFlow() {
  return new Promise((resolve) => {
    console.log("\n2️⃣ Testing Message Flow...");

    // Listen for message received
    socket2.on("new-message", (data) => {
      console.log("📨 Socket 2 received message:", data.message.content);
      testResults.messageReceiving = true;
    });

    // Send message from socket 1
    setTimeout(() => {
      console.log("📤 Socket 1 sending message...");
      socket1.emit("send-message", {
        receiverId: "678fb48c48c48c48c48c48c5", // User 2 ID
        content: "Hello from Socket 1!",
        messageType: "text",
        isGroupChat: false,
      });
      testResults.messageSending = true;
    }, 1000);

    // Listen for message sent confirmation
    socket1.on("message-sent", (data) => {
      console.log("✅ Socket 1 received message-sent confirmation");
      setTimeout(() => {
        resolve();
      }, 500);
    });
  });
}

// Test 3: Online Status
function testOnlineStatus() {
  return new Promise((resolve) => {
    console.log("\n3️⃣ Testing Online Status...");

    socket1.on("user-online", (data) => {
      console.log("🟢 Socket 1 received user-online:", data.user.name);
      testResults.onlineStatus = true;
    });

    socket2.on("user-online", (data) => {
      console.log("🟢 Socket 2 received user-online:", data.user.name);
    });

    socket1.on("online-users", (users) => {
      console.log(
        "👥 Socket 1 received online users list:",
        users.length,
        "users"
      );
      testResults.onlineStatus = true;
    });

    socket2.on("online-users", (users) => {
      console.log(
        "👥 Socket 2 received online users list:",
        users.length,
        "users"
      );
    });

    setTimeout(() => {
      resolve();
    }, 2000);
  });
}

// Test 4: Typing Indicators
function testTypingIndicators() {
  return new Promise((resolve) => {
    console.log("\n4️⃣ Testing Typing Indicators...");

    socket2.on("user-typing", (data) => {
      console.log(
        "⌨️ Socket 2 received typing indicator:",
        data.sender.name,
        "isTyping:",
        data.isTyping
      );
      testResults.typingIndicators = true;
    });

    setTimeout(() => {
      console.log("⌨️ Socket 1 starting typing...");
      socket1.emit("typing-start", {
        receiverId: "678fb48c48c48c48c48c48c5",
      });
    }, 500);

    setTimeout(() => {
      console.log("⌨️ Socket 1 stopping typing...");
      socket1.emit("typing-stop", {
        receiverId: "678fb48c48c48c48c48c48c5",
      });
    }, 1500);

    setTimeout(() => {
      resolve();
    }, 2000);
  });
}

// Test 5: Read Receipts
function testReadReceipts() {
  return new Promise((resolve) => {
    console.log("\n5️⃣ Testing Read Receipts...");

    socket1.on("messages-marked-read", (data) => {
      console.log(
        "📖 Socket 1 received read receipt:",
        data.count,
        "messages read"
      );
      testResults.readReceipts = true;
    });

    setTimeout(() => {
      console.log("📖 Socket 2 marking messages as read...");
      socket2.emit("mark-message-read", {
        messageId: "test-message-id",
        senderId: "678fb48c48c48c48c48c48c4",
      });
    }, 1000);

    setTimeout(() => {
      resolve();
    }, 2000);
  });
}

// Run all tests
async function runAllTests() {
  try {
    await testConnection();
    await testMessageFlow();
    await testOnlineStatus();
    await testTypingIndicators();
    await testReadReceipts();

    // Print results
    console.log("\n📊 Test Results:");
    console.log("================");
    console.log("✅ Connection:", testResults.connection ? "PASS" : "FAIL");
    console.log(
      "✅ Message Sending:",
      testResults.messageSending ? "PASS" : "FAIL"
    );
    console.log(
      "✅ Message Receiving:",
      testResults.messageReceiving ? "PASS" : "FAIL"
    );
    console.log(
      "✅ Online Status:",
      testResults.onlineStatus ? "PASS" : "FAIL"
    );
    console.log(
      "✅ Typing Indicators:",
      testResults.typingIndicators ? "PASS" : "FAIL"
    );
    console.log(
      "✅ Read Receipts:",
      testResults.readReceipts ? "PASS" : "FAIL"
    );

    const passedTests = Object.values(testResults).filter(
      (result) => result
    ).length;
    const totalTests = Object.keys(testResults).length;

    console.log(
      `\n🎯 Overall Score: ${passedTests}/${totalTests} tests passed`
    );

    if (passedTests === totalTests) {
      console.log("🎉 All socket functionality is working correctly!");
    } else {
      console.log("⚠️ Some socket functionality needs attention.");
    }
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // Cleanup
    if (socket1) socket1.disconnect();
    if (socket2) socket2.disconnect();
    console.log("\n🧹 Test cleanup completed");
    process.exit(0);
  }
}

// Start tests
runAllTests();
