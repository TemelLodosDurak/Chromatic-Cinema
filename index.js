/**
 * Import required modules
 */
const axios = require("axios");
const express = require("express");
const sharp = require("sharp");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion } = require("mongodb");
const mongoose = require("mongoose");
require("dotenv").config();

/**
 * Initialize the app and set middleware
 */
const app = express();
app.use(express.static("./public"));
app.use("/firebaseConfig", express.static("firebaseConfig.json"));
const bodyParser = require("body-parser");
app.use(bodyParser.json());

/**
 * Initialize variables and constants
 */
let themeColor = "green";
const apiEndpoint = "https://api.themoviedb.org/3/movie/{movieId}";
const apiKey = process.env.API_KEY;
const dbUser = process.env.DB_USERNAME;
const dbPassword = process.env.DB_PASSWORD;
const language = "en-US";

/**
 * Connect to the database
 */
const uri = `mongodb+srv://${dbUser}:${dbPassword}@clusterchromaticcinema.cdhfty9.mongodb.net/ClusterChromaticCinema?retryWrites=true&w=majority`;
mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("Connected to MongoDB"));

/**
 * Define the User schema for the database
 */
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  favorite_movies: { type: [Number], default: [] },
});
const User = mongoose.model("User", userSchema);

/**
 * Initialize Firebase Admin and set the auth middleware
 */
const serviceAccount = require("./chromatic-cinema-firebase-adminsdk-i6t8s-49bf2f33ad.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();
/**
 * Authorization middleware
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @param {function} next - The next function to call
 * @returns {Promise} Promise representing the authorization middleware
 */
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("Unauthorized");
  }
  const token = authHeader.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.log(error);
    res.status(401).send("Unauthorized");
  }
};

/**
 * Save the user to the MongoDB database
 * @param {string} uid - The user ID
 * @param {string} email - The user email
 * @returns {Promise} Promise representing the saveUserToDatabase function
 */
async function saveUserToDatabase(uid, email) {
  const newUser = new User({
    uid: uid,
    email: email,
    favorite_movies: [],
  });
  try {
    await newUser.save();
    console.log(`User with uid ${uid} saved to the database`);
  } catch (error) {
    console.error(`Error while saving user with uid ${uid}: ${error.message}`);
  }
}

/**
 * Define a set of color synonyms for each color
 */
const colorSynonyms = {
  red: ["Crimson", "Scarlet", "Burgundy", "Cherry", "Ruby", "Rose", "Maroon"],
  blue: ["Navy", "Azure", "Cobalt", "Indigo", "Sapphire", "Sky", "Cerulean"],
  green: ["Emerald", "Olive", "Lime", "Forest", "Sage", "Chartreuse", "Kelly"],
  yellow: ["Gold", "Lemon", "Canary", "Amber", "Mustard", "Butter", "Blonde"],
  purple: ["Lavender", "Violet", "Mauve", "Plum", "Grape", "Lilac", "Amethyst"],
};

/**
 * Modify the given movie title by replacing a random word with a synonym of the specified color.
 * If the title has only one word, the synonym is added either to the beginning or the end of the title.
 *
 * @param {string} title - The original movie title to modify.
 * @param {string} color - The color to use for generating a synonym.
 * @returns {string} The modified movie title.
 */
function modifyTitle(title, color) {
  /**
   * An object that maps colors to arrays of synonyms.
   * @type {Object.<string, string[]>}
   */
  const synonyms = colorSynonyms[color];

  /**
   * A random synonym of the specified color.
   * @type {string}
   */
  const pickedSynonym = synonyms[Math.floor(Math.random() * synonyms.length)];

  /**
   * An array of words in the original movie title.
   * @type {string[]}
   */
  const words = title.split(" ");

  if (words.length < 2) {
    if (Math.random() < 0.5) {
      words.unshift(pickedSynonym);
    } else {
      words.push(pickedSynonym);
    }
    return words.join(" ");
  } else {
    const randomIndex = Math.floor(Math.random() * words.length);
    words[randomIndex] = pickedSynonym;
    return words.join(" ");
  }
}

/**
 * Pick a random hex value between #300000 and #FF0000 for red, #000030 and #0000FF for blue,
 * #003000 and #00FF00 for green, #303000 and #FFFF00 for yellow, and #300030 and #FF00FF for purple.
 * The picked hex value is used to generate a color tint for the movie poster.
 *
 * @param {string} color - The color for which to generate a color tint.
 * @returns {string} The generated color tint in the format "#RRGGBB".
 */
function pickColorTint(color) {
  /**
   * The minimum hex value for the specified color.
   * @type {number}
   */
  const min = parseInt("30", 16);

  /**
   * The maximum hex value for the specified color.
   * @type {number}
   */
  const max = parseInt("FF", 16);

  /**
   * A random hex value between min and max.
   * @type {number}
   */
  const randomValue = Math.floor(Math.random() * (max - min + 1)) + min;

  /**
   * The picked hex value in string format.
   * @type {string}
   */
  const randomHex = randomValue.toString(16);

  switch (color) {
    case "red":
      return "#" + randomHex + "0000";
    case "blue":
      return "#0000" + randomHex;
    case "green":
      return "#00" + randomHex + "00";
    case "yellow":
      return "#" + randomHex + randomHex + "00";
    case "purple":
      return "#" + randomHex + "00" + randomHex;
    default:
      return "#000000";
  }
}

/**
 * Applies a color tint to an image using Sharp.
 * @async
 * @function applyColorTint
 * @param {string} imageUrl - The URL of the image to be tinted.
 * @param {string} color - The color to tint the image with.
 * @returns {Promise<Buffer>} - A promise that resolves with the tinted image buffer.
 */
async function applyColorTint(imageUrl, color) {
  const imageBuffer = await axios.get(
    "https://image.tmdb.org/t/p/w500/" + imageUrl,
    {
      responseType: "arraybuffer",
    }
  );
  const tintedImageBuffer = await sharp(imageBuffer.data)
    .tint(pickColorTint(color))
    .toBuffer();
  return tintedImageBuffer;
}

/**
 * Modifies a movie's title and poster image by applying a color tint to the poster.
 * @async
 * @function modifyMovies
 * @param {Object} element - The movie to be modified.
 * @param {string} color - The color to tint the poster image with.
 * @returns {Promise<Object>} - A promise that resolves with the modified movie object.
 */
async function modifyMovies(element, color) {
  const { original_title, poster_path } = element;

  const modifiedTitle = modifyTitle(original_title, color);
  const tintedImageBuffer = await applyColorTint(poster_path, color);

  const base64Image = Buffer.from(tintedImageBuffer).toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64Image}`;

  const modifiedResponse = {
    ...element,
    title: modifiedTitle,
    poster: dataUrl,
  };

  return modifiedResponse;
}

/**
 * Sets the theme color for the server.
 * @function setThemeColor
 * @param {string} color - The color to set the theme to.
 * @returns {void}
 */
function setThemeColor(color) {
  themeColor = color;
}

/**
 * Gets the theme color for the server.
 * @function getThemeColor
 * @returns {Object} - An object containing the theme color.
 */
function getThemeColor() {
  return { color: themeColor };
}

/**
 * Set the theme color for the server
 * @param {string} color - The color to set as the theme
 * @returns {void}
 */
app.post("/theme", (req, res) => {
  setThemeColor(req.body.color);
  res.send(getThemeColor());
});

/**
 * Get the theme color for the server
 * @returns {string} - The current theme color
 */
app.get("/theme", (req, res) => {
  res.send(getThemeColor());
});

/**
 * Serve the homepage
 * @returns {void}
 */
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

/**
 * API endpoint to fetch movie data
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {object} - The modified movie data
 */
app.get("/movie/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch movie data from API
    const response = await axios.get(
      `https://api.themoviedb.org/3/movie/${id}`,
      {
        params: {
          api_key: apiKey,
          language,
        },
      }
    );
    const movie = response.data;

    // Modify the movie using modifyMovies function
    const modifiedMovie = await modifyMovies(movie, themeColor);

    // Send modified response as JSON
    res.json(modifiedMovie);
  } catch (error) {
    console.log(error);
    res.status(500).send("Internal server error");
  }
});

/**
 * API endpoint to search for movies with pagination
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {object} - The modified movie search results and total pages
 */
app.get("/search/:query/:page", authMiddleware, async (req, res) => {
  const { query, page } = req.params;

  // Set the number of results per page
  const perPage = 6;

  try {
    // Fetch movie data from API with pagination
    const response = await axios.get(
      "https://api.themoviedb.org/3/search/movie",
      {
        params: {
          api_key: apiKey,
          language,
          query,
          page,
        },
      }
    );

    // Extract the movies from the API response and filter out movies with NULL posters
    const allMovies = response.data.results.filter(
      (movie) => movie.poster_path !== null
    );

    // Calculate the total number of pages
    const totalPages = Math.ceil(allMovies.length / perPage);

    // Calculate the start and end index for slicing the results
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;

    // Limit the number of results by slicing the array
    const movies = allMovies.slice(startIndex, endIndex);

    // Modify each movie in the array using the modifyMovies function
    const modifiedMovies = await Promise.all(
      movies.map((movie) => modifyMovies(movie, themeColor))
    );

    // Send the modified response objects and total pages back to the client
    res.send({
      results: modifiedMovies,
      total_pages: totalPages,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error.");
  }
});

/**
 * Retrieves data on popular movies and returns a modified version of the movies array.
 * @async
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {Promise} - The modified movies as a JSON response.
 */
app.get("/popular", async (req, res) => {
  try {
    // Fetch movie data from API
    const response = await axios.get(
      "https://api.themoviedb.org/3/movie/popular",
      {
        params: {
          api_key: apiKey,
          language,
        },
      }
    );
    const movies = response.data.results;

    // Modify each movie in the array (title and poster)
    const modifiedMovies = await Promise.all(
      movies.map((movie) => modifyMovies(movie, themeColor))
    );

    // Send modified movies as response
    res.json(modifiedMovies);
  } catch (error) {
    console.log(error);
    res.status(500).send("Internal server error");
  }
});

/**
 * Retrieves data on top rated movies and returns a modified version of the movies array.
 * @async
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {Promise} - The modified movies as a JSON response.
 */
app.get("/top_rated", async (req, res) => {
  try {
    // Fetch top rated movie data from API
    const response = await axios.get(
      "https://api.themoviedb.org/3/movie/top_rated",
      {
        params: {
          api_key: apiKey,
          language,
        },
      }
    );
    const movies = response.data.results;

    // Modify each movie in the array (title and poster)
    const modifiedMovies = await Promise.all(
      movies.map((movie) => modifyMovies(movie, themeColor))
    );

    // Send modified movies as response
    res.json(modifiedMovies);
  } catch (error) {
    console.log(error);
    res.status(500).send("Internal server error");
  }
});

/**
 * Retrieves user data from the database and returns it as a JSON response.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {Promise} - The user data as a JSON response.
 */
app.get("/profile", authMiddleware, (req, res) => {
  const uid = req.user.uid;

  User.findOne({ uid })
    .then((user) => {
      if (!user) {
        console.error(`User with uid ${uid} not found`);
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    })
    .catch((error) => {
      console.error(
        `Error while finding user with uid ${uid}: ${error.message}`
      );
      res.status(500).json({ error: "Internal server error" });
    });
});

/**
 * Handles user signup.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 */
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userRecord = await auth.createUser({ email, password });
    await saveUserToDatabase(userRecord.uid, email);
    res.status(201).json({ uid: userRecord.uid });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Handles user signup with Google.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 */
app.post("/signup-with-google", async (req, res) => {
  const { email, token } = req.body;

  try {
    const decodedToken = await auth.verifyIdToken(token);
    if (decodedToken.email !== email) {
      throw new Error("Token email does not match request email");
    }

    const userRecord = await auth.getUser(decodedToken.uid);
    if (!userRecord.emailVerified) {
      throw new Error("User email is not verified");
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(409).json({ error: "User already exists" });
      return;
    }

    await saveUserToDatabase(decodedToken.uid, email);
    res.status(201).json({ uid: decodedToken.uid });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Lists favorite movies for a user.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 */
app.get("/favorites", authMiddleware, async (req, res) => {
  const uid = req.user.uid;

  try {
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const favoriteMoviesPromises = user.favorite_movies.map(async (movieId) => {
      const response = await axios.get(
        `https://api.themoviedb.org/3/movie/${movieId}`,
        {
          params: {
            api_key: process.env.API_KEY,
          },
        }
      );

      const modifiedResponse = await modifyMovies(response.data, themeColor);
      return modifiedResponse;
    });

    const favoriteMovies = await Promise.all(favoriteMoviesPromises);
    const modifiedFavoriteMovies = favoriteMovies.reduce((acc, movie) => {
      acc[movie.id] = movie;
      return acc;
    }, {});

    res.json(modifiedFavoriteMovies);
  } catch (error) {
    console.error("Error fetching favorite movies:", error);
    res.status(500).json({ error: "Failed to fetch favorite movies" });
  }
});

/**
 * Check if a movie is in the user's favorites list
 * @param {Object} req - The request object
 * @param {Object} req.user - The user object obtained from the authentication middleware
 * @param {string} req.user.uid - The user ID
 * @param {Object} req.params - The route parameters
 * @param {string} req.params.movieId - The ID of the movie to check
 * @param {Object} res - The response object
 * @returns {Object} - The response object with the `isFavorite` property indicating if the movie is in the user's favorites list or not
 */
app.get("/favorites/check/:movieId", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const movieId = parseInt(req.params.movieId);

  try {
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isFavorite = user.favorite_movies.includes(movieId);
    res.json({ isFavorite });
  } catch (error) {
    console.error(`Error while checking favorite movie: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Add a movie to the user's favorites list
 * @param {Object} req - The request object
 * @param {Object} req.user - The user object obtained from the authentication middleware
 * @param {string} req.user.uid - The user ID
 * @param {Object} req.params - The route parameters
 * @param {string} req.params.movieId - The ID of the movie to add
 * @param {Object} res - The response object
 * @returns {Object} - The response object with a `message` property indicating that the movie has been added to the user's favorites list
 */
app.post("/favorites/:movieId", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const movieId = parseInt(req.params.movieId);

  try {
    const user = await User.findOneAndUpdate(
      { uid },
      { $addToSet: { favorite_movies: movieId } }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "Movie added to favorites" });
  } catch (error) {
    console.error(`Error while adding favorite movie: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Delete a movie from the user's favorites list.
 *
 * @route DELETE /favorites/:movieId
 * @param {Object} req - The request object.
 * @param {Object} req.user - The user object obtained from the authentication middleware.
 * @param {string} req.user.uid - The UID of the authenticated user.
 * @param {Object} req.params - The request parameters.
 * @param {number} req.params.movieId - The ID of the movie to be removed.
 * @param {Object} res - The response object.
 * @returns {Object} The response object containing a message indicating that the movie has been removed from the user's favorites list.
 * @throws {Object} An error object containing the error message.
 */
app.delete("/favorites/:movieId", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const movieId = parseInt(req.params.movieId);

  try {
    const user = await User.findOneAndUpdate(
      { uid },
      { $pull: { favorite_movies: movieId } }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "Movie removed from favorites" });
  } catch (error) {
    console.error(`Error while removing favorite movie: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Check if a given email exists in the database.
 *
 * @route GET /check-email/:email
 * @param {Object} req - The request object.
 * @param {Object} req.params - The request parameters.
 * @param {string} req.params.email - The email to be checked.
 * @param {Object} res - The response object.
 * @returns {Object} The response object containing a boolean indicating whether the email exists in the database or not.
 * @throws {Object} An error object containing the error message.
 */
app.get("/check-email/:email", async (req, res) => {
  const email = req.params.email;

  try {
    const user = await User.findOne({ email });
    if (user) {
      res.json({ exists: true });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error(`Error while checking email: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Start the server and listen for incoming requests.
 *
 * @param {number} [port=3001] - The port on which the server will listen for incoming requests.
 * @returns {void}
 */
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server listening on port http://localhost:${port}`);
});
