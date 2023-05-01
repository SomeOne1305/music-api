const express = require("express");
const fs = require("fs");
const path = require("path");
const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");
const multer = require("multer");
const { urlencoded, json } = require("body-parser");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { transliterate } = require("transliteration");
const port = process.env.PORT || 8000;
const app = express();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let destinationPath = "";
    // Check if the uploaded file is an image
    if (file.mimetype.startsWith("image/")) {
      destinationPath = "images/";
    } else if (file.mimetype.startsWith("audio/")) {
      destinationPath = "music/";
    } else {
      return cb(new Error("Invalid file type"));
    }
    cb(null, destinationPath);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    let originalname = file.originalname;
    originalname = originalname.replace(/[^\w\d_\.\-]/g, "");
    originalname = transliterate(originalname, { unknown: "-" });
    cb(null, `${timestamp}-${originalname}`);
  },
});
const upload = multer({ storage: storage });

app.use(urlencoded({ extended: true }));
app.use(json());
app.use(cookieParser());

let musics = [];
let users = [];
if (fs.existsSync("musicData.json")) {
  const data = fs.readFileSync("musicData.json", "utf-8");
  musics = JSON.parse(data);
}
if (fs.existsSync("users.json")) {
  const data = fs.readFileSync("users.json", "utf-8");
  users = JSON.parse(data);
}

// Routes
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/template.html");
});

app.get('/api/v1/musics',(req,res)=>{
  res.status(200).json(musics)
})

app.get('/api/v1/musics/:id',(req,res)=>{
  if (musics[parseInt(req.params.id)]) {
    res.status(200).json(musics[parseInt(req.params.id)])
  } else {
    res.status(404).send('<span style="font-family:monospace;font-size:16px;">404 Not Found</span>');
  }
})
app.get('/api/v1/users',(req,res)=>{
  res.status(200).json(users)
})
app.get('/api/v1/users/:id',(req,res)=>{
  if (users[parseInt(req.params.id)]) {
    res.status(200).json(users[parseInt(req.params.id)])
  } else {
    res.status(404).send('<span style="font-family:monospace;font-size:16px;">404 Not Found</span>');
  }
})
app.post("/register", upload.single("avatar"), async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!users.find((e) => e.email === email)) {
    const profile = req.file.filename;
    const newUser = {
      id: crypto.randomBytes(16).toString("hex"),
      firstName,
      lastName,
      avatar: req.protocol + "://" + req.get("host") + "/images/" + profile,
      email,
      password,
      createdAt: new Date(),
    };
    users.push(newUser);
    try {
      await fs.promises.writeFile("users.json", JSON.stringify(users));
      console.log("User is registered successfully !");
      const token = jwt.sign(newUser, "my-secr3t-da", { expiresIn: "30 days" });
      res.cookie("__token", token, {
        httpOnly: true,
        secure: true,
        maxAge: 2592000000,
      });
      res.status(201).redirect("/");
    } catch (err) {
      console.error(err);
      res.status(500).send("Error saving user");
    }
  } else {
    res.status(302).send({ error: "You were registered before" });
  }
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const existedUser = users.find((e) => e.email === email);
  if (existedUser) {
    if (existedUser.password === password) {
      const index = users.findIndex((e) => e.email === email);
      const token = jwt.sign(users[index], "my-secr3t-da", {
        expiresIn: "30 days",
      });
      console.log(existedUser.password);
      res
        .cookie("__token", token, {
          httpOnly: true,
          secure: true,
          maxAge: 2592000000,
        })
        .redirect("/");
    } else {
      res.status(401).send("Email or password is incorrect");
    }
  } else {
    res.status(401).send("Email or password is incorrect");
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("__token").redirect("/");
});

app.delete("/delete", async (req, res) => {
  let renewedData = users.filter((e) => e.id !== req.user);
  try {
    await fs.promises.writeFile("users.json", JSON.stringify(renewedData));
    res.clearCookie("__token").status(202).send("User is deleted successfully");
    console.log("User is deleted");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting user");
  }
});







app.post(
  "/upload",
  upload.fields([
    { name: "backgroundImg", maxCount: 1 },
    { name: "music", maxCount: 1 },
  ]),
  async (req, res) => {
    if (req.cookies.__token) {
      const { artist, musicName, type } = req.body;
      try {
        const duration = await ffprobe(req.files['music'][0].path, {
          path: ffprobeStatic.path,
        }).then((info) => info.streams[0].duration);

        const newMusic = {
          id: jwt.verify(req.cookies.__token, "my-secr3t-da").id,
          artist,
          musicName,
          musicUrl:
            req.protocol +
            "://" +
            req.get("host") +
            "/music/" +
            req.files['music'][0].filename,
          backgroundImg:
            req.protocol +
            "://" +
            req.get("host") +
            "/images/" +
            req.files['backgroundImg'][0].filename,
          type,
          duration,
          likes: 0,
          postedAt: new Date(),
        };
        musics.push(newMusic);
        await fs.promises.writeFile("musicData.json", JSON.stringify(musics));
        res.status(201).send('ok')
      } catch (err) {
        console.error(err);
      }
    } else {
      res.status(401).send("Unauthorozied access");
      res.redirect("/register");
    }
  }
);


app.get("*", (req, res) => {
  // Parsing the URL
  const request = new URL(
    req.protocol + "://" + req.get("host") + req.originalUrl
  );
  // Extracting the path of file
  const action = request.pathname;
  // Path Refinements
  const filePath = path.join(__dirname, action).split("%20").join(" ");
  // Checking if the path exists
  fs.exists(filePath, function (exists) {
    if (!exists) {
      res.status(404).send('<span style="font-family:monospace;font-size:16px;">404 Not Found</span>');
      return;
    }
    // Extracting file extension
    const ext = path.extname(action);
    // Setting default Content-Type
    let contentType = "text/plain";
    // Checking if the extension of
    // image is '.png'
    if (ext === ".png") {
      contentType = "image/png";
    } else if (ext === ".jpeg") {
      contentType = "image/jpeg";
    } else if (ext === ".jpeg") {
      contentType = "image/jpg";
    }
    // Setting the headers
    res.set({
      "Content-Type": contentType,
    });
    // Reading the file
    fs.readFile(filePath, function (err, content) {
      // Serving the image
      res.send(content);
    });
  });
});

app.listen(port, () => {
  console.log(`App listing on port ${port}`);
});
const scheme = {
  id: "",
  artist: "",
  musicName: "",
  musicUrl: "",
  type: "",
  duration: "",
  backgroundImg: "",
  likes: 0,
  postedAt: new Date(),
};

module.exports = app;
