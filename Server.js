const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const dotenv = require('dotenv');
const { join } = require('path');
const app = express();
const bodyParser = require('body-parser');
const fs = require('fs');
const uuid = require('uuid');
const cors = require('cors'); // Add this line
const puppeteerConfig = require('./cache/.puppeteerrc.cjs');

const port = 3008;
dotenv.config();

app.use('/uploads', express.static('uploads', { maxAge: 31536000000 * 10000 }));
 // Cache for approximately 1000 years

app.use(cors());

// Set up mongoose connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
 
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.static('public'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Allow requests only from a specific origin
const corsOptions = {
  origin: 'https://qubithub.onrender.com', // Replace with your allowed origin
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

  // Changes the cache location for Puppeteer.



const GalleryItem = mongoose.model('GalleryItem', {
  title: String,
  category: String,
  image: String,
  link: String,
  screenshotPath: String,
});

const Client = mongoose.model('Client', {
  name: String,
  logoPath: String,
});

const Testimonial = mongoose.model('Testimonial', {
  quote: String,
  author: String,
  company: String,
});


const puppeteer = require('puppeteer');

// ... (other configurations)

async function captureScreenshot(url, customScreenshotPath) {
  const browser = await puppeteer.launch({ headless: 'new',  ...puppeteerConfig, });
  
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1200, height: 900 });
        // Set a timeout for page navigation
        await page.goto(url, { timeout: 40000 });

        // Delay the screenshot capture (60 seconds)
        await new Promise(resolve => setTimeout(resolve, 60000));

    // Save the screenshot with the custom path
    await page.screenshot({ path: customScreenshotPath, fullPage: false });
  } catch (err) {
    console.error('Error capturing screenshot:', err);
  } finally {
    await browser.close();
  }
}

// ... (other model and route definitions)
let firstGalleryItemScreenshotPath = null;

async function captureFirstGalleryItemScreenshot() {
  const galleryItems = await GalleryItem.find();

  // Ensure the "uploads" directory exists
  const uploadsDir = './uploads';
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }

  await Promise.all(
    galleryItems.map(async (item) => {
      if (item.link && !item.screenshotPath) {
        const uniqueId = uuid.v4();
        const screenshotPath = `./uploads/${item._id.toString()}-screenshot_${uniqueId}.png`;

        try {
          await captureScreenshot(item.link, screenshotPath);
          // Save the screenshot path in the database
          await GalleryItem.findByIdAndUpdate(item._id, { screenshotPath });
        } catch (err) {
          console.error('Error capturing screenshot:', err);
        }
      }
    })
  );
}




app.get('/', async (req, res) => {
  try {
    const clients = await Client.find();
    const testimonials = await Testimonial.find();

    // Capture the first gallery item screenshot and screenshots for each gallery item if not already captured
    await captureFirstGalleryItemScreenshot();
    const galleryItemScreenshots = await captureGalleryItemScreenshots();

    // Fetch all gallery items
    const galleryItems = await GalleryItem.find();

    // Use the corresponding screenshot path for each gallery item
    const galleryItemsWithScreenshots = galleryItems.map((item) => {
      const itemScreenshot = galleryItemScreenshots.find((screenshot) => screenshot.includes(item._id.toString()));
      return { ...item.toObject(), screenshotPath: itemScreenshot || null };
    });

    res.render('index', { galleryItems: galleryItemsWithScreenshots, galleryItemScreenshots, testimonials, clients });
  } catch (err) {
    console.error('Error fetching data:', err);
    res.status(500).send('Internal Server Error');
  }
});

async function captureGalleryItemScreenshots() {
  const galleryItems = await GalleryItem.find();

  // Ensure the "uploads" directory exists
  const uploadsDir = './uploads';
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }

  // Capture screenshots for each gallery item
  const screenshots = await Promise.all(
    galleryItems.map(async (item) => {
      // If the gallery item already has a screenshot, do nothing
      if (item.screenshotPath) {
        return item.screenshotPath;
      }

      const screenshotPath = `./uploads/${item._id.toString()}-screenshot.png`;

      try {
        await captureScreenshot(item.link, screenshotPath);
        // Save the screenshot path in the database
        await GalleryItem.findByIdAndUpdate(item._id, { screenshotPath });
        return screenshotPath;
      } catch (err) {
        console.error('Error capturing screenshot:', err);
        return null;
      }
    })
  );

  // Return an array of all screenshot paths
  return screenshots.filter(Boolean);
}



// Display gallery items on the admin page
app.get('/addgallery', async (req, res) => {
  try {
    const galleryItems = await GalleryItem.find();
    res.render('addgallery', { galleryItems });
  } catch (err) {
    console.error('Error fetching gallery items:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/addgallery', upload.single('image'), async (req, res) => {
  // Extract data from the form
  const { title, category, link } = req.body;

  // Create a new GalleryItem document
  const newItem = new GalleryItem({
    title: title,
    category: category,
    image: req.file.filename, // Use the filename stored by multer
    link: link,
  });

  try {
    // Save the document to the database
    await newItem.save();
    // console.log('Item added to the database:', newItem);
    res.redirect('/'); // Redirect to the home page or another appropriate route
  } catch (err) {
    console.error('Error adding item to the database:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/pricing', (req, res) => {
  res.render('pricing');
});

// Delete gallery item by ID
app.post('/delete/:id', async (req, res) => {
  const itemId = req.params.id;

  try {
    await GalleryItem.findByIdAndDelete(itemId);
    console.log('Item deleted from the database:', itemId);
    res.redirect('/addgallery');
  } catch (err) {
    console.error('Error deleting item from the database:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/addtestimonial', async (req, res) => {
  const testimonials = await Testimonial.find();
  res.render('addtestimonial', { testimonials });
});

app.post('/addtestimonial', async (req, res) => {
  const { quote, author, company } = req.body;
  const newTestimonial = new Testimonial({ quote, author, company });

  try {
    await newTestimonial.save();
    res.redirect('/');
  } catch (err) {
    console.error('Error adding testimonial to the database:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Add this route for uploading clients
app.get('/addclient', async (req, res) => {
  try {
    const clients = await Client.find();
    res.render('addclient', { clients });
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/addclient', upload.single('logo'), async (req, res) => {
  // Extract data from the form
  const { name } = req.body;

  // Create a new Client document
  const newClient = new Client({
    name: name,
    logoPath: req.file.filename, // Use the filename stored by multer
  });

  try {
    // Save the document to the database
    await newClient.save();
    res.redirect('/addclient'); // Redirect to the client admin page or another appropriate route
  } catch (err) {
    console.error('Error adding client to the database:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ... (previous code)

// Delete client by ID
app.get('/deleteclient/:id', async (req, res) => {
  const clientId = req.params.id;

  try {
    await Client.findByIdAndDelete(clientId);
    console.log('Client deleted from the database:', clientId);
    res.redirect('/addclient');
  } catch (err) {
    console.error('Error deleting client from the database:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ... (remaining code)
// Add this route for deleting testimonials
app.post('/deletetestimonial/:id', async (req, res) => {
  const testimonialId = req.params.id;

  try {
    await Testimonial.findByIdAndDelete(testimonialId);
    console.log('Testimonial deleted from the database:', testimonialId);
    res.redirect('/addtestimonial');
  } catch (err) {
    console.error('Error deleting testimonial from the database:', err);
    res.status(500).send('Internal Server Error');
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
