const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');  // You'll need to install this package


const app = express();
const SECRET_KEY = 'your-secret-key'; // Use a secure key in production

// Middleware
app.use(bodyParser.json());

// Enable CORS if needed
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/QT_map', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const UserModel = mongoose.model('users', UserSchema);

// Login endpoint
app.post('/validateUser', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate input
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username and password are required' 
            });
        } 
        

        const user = await UserModel.findOne({ username, password });
        if (user) {
            // Generate JWT token
            const token = jwt.sign(
                { userId: user._id, username: user.username },
                SECRET_KEY,
                { expiresIn: '24h' }
            );
            
            res.json({ 
                success: true, 
                message: 'User validated successfully',
                token: token,
                username: user.username,
                userId: user._id.toString()  // Add this line to include the MongoDB ID
            });
        } else {
            res.status(401).json({ 
                success: false, 
                message: 'Invalid username or password' 
            });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// Signup endpoint
app.post('/signup', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate input
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username and password are required' 
            });
        }

        // Check if username exists
        const existingUser = await UserModel.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username already exists' 
            });
        }

        // Create new user
        const newUser = new UserModel({ username, password });
        await newUser.save();

        res.json({ 
            success: true, 
            message: 'User registered successfully' 
        });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// Verify token middleware
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'No token provided' 
        });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid token' 
        });
    }
};

// Protected route example
app.get('/protected', verifyToken, (req, res) => {
    res.json({ 
        success: true, 
        message: 'Protected data', 
        user: req.user 
    });
});   

///////////////////////////////////////////////////
////////////////////settings collection///////////

// Settings Schema (keep only one version)
// Settings Schema - Update timezone type to Number
const SettingsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'users' },
    general: {
        pastDataHours: { type: Number, default: 24 },
        dataRefresh: { type: Number, default: 5 },
        timezone: { type: Number, default: 0.0 }  // Changed to Number for offset storage
    },
    pastTrail: {
        hours: { type: Number, default: 24 },
        plotSize: { type: String, default: 'Small' }
    },
    updatedAt: { type: Date, default: Date.now }
});

const SettingsModel = mongoose.model('settings', SettingsSchema);

// Save settings endpoint
app.post('/saveSettings', verifyToken, async (req, res) => {
    try {
        const { userId, settings } = req.body;
        
        // Debug log
        console.log('Received request body:', JSON.stringify(req.body, null, 2));

        if (!userId || !settings) {
            return res.status(400).json({
                success: false,
                message: 'UserId and settings are required'
            });
        }

        // Validate settings structure
        if (!settings.general) {
            return res.status(400).json({
                success: false,
                message: 'Invalid settings structure. General section is required.'
            });
        }

        // Validate required fields
        if (!settings.general.pastDataHours || 
            !settings.general.dataRefresh || 
            settings.general.timezone === undefined ||  // Changed validation for timezone
            !settings.pastTrail.hours || 
            !settings.pastTrail.plotSize) {
            return res.status(400).json({
                success: false,
                message: 'Missing required settings fields'
            });
        }

        // Format the settings data with safe parsing
        const formattedSettings = {
            general: {
                pastDataHours: parseInt(settings.general.pastDataHours) || 24,
                dataRefresh: parseInt(settings.general.dataRefresh) || 5,
                timezone: parseFloat(settings.general.timezone) || 0.0  // Parse as float for offset
            },
            pastTrail: {
                hours: parseInt(settings.pastTrail.hours) || 24,
                plotSize: settings.pastTrail.plotSize || "Small"
            }
        };

        // Validate timezone offset range
        if (formattedSettings.general.timezone < -12.0 || formattedSettings.general.timezone > 14.0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid timezone offset. Must be between -12.0 and +14.0'
            });
        }

        // Debug log
        console.log('Formatted settings:', JSON.stringify(formattedSettings, null, 2));

        // Update or create settings
        const updatedSettings = await SettingsModel.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId) },
            { 
                $set: {
                    ...formattedSettings,
                    updatedAt: new Date()
                }
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: 'Settings saved successfully',
            settings: updatedSettings
        });

    } catch (err) {
        console.error('Save settings error:', err);
        console.error('Request body:', req.body);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: err.message
        });
    }
});

////////////////////////////
//////////////////////////// 

app.get('/getSettings/:userId', verifyToken, async (req, res) => {
    try {
        console.log('Received request for settings');
        console.log('UserId:', req.params.userId);
        console.log('Auth header:', req.headers.authorization);

        const userId = req.params.userId;

        if (!userId) {
            console.log('No userId provided');
            return res.status(400).json({
                success: false,
                message: 'UserId is required'
            });
        }

        console.log('Looking for settings with userId:', userId);
        const settings = await SettingsModel.findOne({ 
            userId: new mongoose.Types.ObjectId(userId) 
        });

        console.log('Found settings:', settings);

        if (!settings) {
            console.log('No settings found');
            return res.status(404).json({
                success: false,
                message: 'Settings not found for this user'
            });
        }

        console.log('Sending settings response');
        res.json({
            success: true,
            message: 'Settings retrieved successfully',
            settings: settings
        });

    } catch (err) {
        console.error('Get settings error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: err.message
        });
    }
});
///////////////////////////////

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});