require("dotenv").config();
express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const { clearInterval } = require("timers");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");

app.use(cookieParser());
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;
const JWT_SECRET = "supersecretkey";

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  watchlist: [String], // Array to store user's watchlist
});
const User = mongoose.model("User", UserSchema);

const authenticate = (req, res, next) => {
  const token = req.cookies.token; // Get token from the cookies

  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(403).send("Forbidden");
    }
    req.user = decoded; // Attach decoded user information to the request
    next();
  });
};

const fetchAllStockSymbols = async () => {
  try {
    const response = await axios.get("https://finnhub.io/api/v1/stock/symbol", {
      params: {
        exchange: "US",
        token: API_KEY,
      },
    });

    return response.data;
  } catch (error) {
    console.error("Error fetching stock symbols:", error.message);
    return [];
  }
};

const fetchStockData = async (symbol) => {
  try {
    const res = await axios.get(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`
    );
    return { symbol, ...res.data };
  } catch (error) {
    console.error(`Error fetching stock data for ${symbol}:`, error.message);
    return null;
  }
};

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const newUser = new User({
      username,
      password: hashedPassword,
      watchlist: [],
    });
    await newUser.save();

    res.status(201).send({ msg: "User registered successfully!" });
  } catch (error) {
    res.status(500).send({ msg: "Error registering user" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).send("User not found");

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).send("Invalid credentials");

    const token = jwt.sign(
      { username: user.username, id: user._id },
      JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );
    res.cookie("token", token, {
      httpOnly: true, // Can't be accessed by JS (more secure)
      secure: process.env.NODE_ENV === "production", // Only send over HTTPS in production
      maxAge: 3600000, // Token expiration in milliseconds (1 hour)
    });
    res.json({ message: "Login successful!" });
  } catch (error) {
    res.status(500).send("Error logging in");
  }
});

app.get("/login", (req, res) => {
  res.render("login"); // Render the login page
});

app.get("/dashboard", authenticate, async (req, res) => {
  const symbols = await fetchAllStockSymbols();
  const user = await User.findOne({ username: req.user.username });
  let arr = [];
  symbols.map((s) => {
    arr.push(s.symbol);
  });
  console.log(arr);
  return arr;
  res.render("dashboard", {
    symbols,
    username: user.username,
  });
});

app.get("/watchlist", authenticate, async (req, res) => {
  const userId = req.user.id;
  const userWatchlist = await User.findById(userId).select("watchlist");

  const stockDetailsPromises = userWatchlist.watchlist.map((symbol) =>
    fetchStockData(symbol)
  );
  const stockDetails = await Promise.all(stockDetailsPromises);
  console.log("watchlist3333333333333333", stockDetails);
  res.render("watchlist", {
    // username: user.username,
    watchlist: stockDetails,
  });
});

app.post("/watchlist", authenticate, async (req, res) => {
  const { symbol } = req.body;
  const user = await User.findOne({ username: req.user.username });

  if (!user.watchlist.includes(symbol)) {
    user.watchlist.push(symbol);
    await user.save();
  }
  res.json(user.watchlist);
});

app.delete("/watchlist", authenticate, async (req, res) => {
  const { symbol } = req.body;
  const user = await User.findOne({ username: req.user.username });

  user.watchlist = user.watchlist.filter((s) => s !== symbol);
  await user.save();
  res.json(user.watchlist);
});

io.on("connection", (socket) => {
  let userStocks = [];
  const sendStockUpdates = async () => {
    const stockDataPromises = userStocks.map((symbol) =>
      fetchStockData(symbol)
    );
    const stockData = await Promise.all(stockDataPromises);
    socket.emit(
      "stockUpdates",
      stockData.filter((data) => data !== null)
    );
  };

  sendStockUpdates();
  const interval = setInterval(sendStockUpdates, 5000);

  socket.on("changeSymbol", (symbol) => {
    console.log(`Symbol changed to: ${symbol}`);
    currentSymbol = symbol;
    sendStockUpdate();
  });

  socket.on("addStock", (symbol) => {
    if (!userStocks.includes(symbol)) {
      userStocks.push(symbol);
      sendStockUpdates(); // Fetch and send updates after adding
    }
  });

  // Remove stock symbol
  socket.on("removeStock", (symbol) => {
    userStocks = userStocks.filter((s) => s !== symbol);
    sendStockUpdates(); // Fetch and send updates after removing
  });

  socket.on("disconnect", () => {
    clearInterval(interval);
    console.log("user disconnected");
  });
});

app.get("/", async (req, res) => {
  res.render("index");
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
