const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const canvas = require('canvas');
const fs = require('fs');
const crypto = require('crypto');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const { resolve } = require('path');
const { request } = require('http');

require('dotenv').config({path:'/mnt/c/Users/raych/Documents/Coding/ECS162/microblog/scaffold/.env'});
const EMOJI_KEY = process.env.EMOJI_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const dbFileName = process.env.DATABASE_FILE_NAME;

const REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

let db;

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = 3000;

passport.authenticate('google', { scope: ['profile'] });
passport.use(new GoogleStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: `http://localhost:${PORT}/auth/google/callback`
}, (token, tokenSecret, profile, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

/*
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    Handlebars Helpers

    Handlebars helpers are custom functions that can be used within the templates 
    to perform specific tasks. They enhance the functionality of templates and 
    help simplify data manipulation directly within the view files.

    In this project, two helpers are provided:
    
    1. toLowerCase:
       - Converts a given string to lowercase.
       - Usage example: {{toLowerCase 'SAMPLE STRING'}} -> 'sample string'

    2. ifCond:
       - Compares two values for equality and returns a block of content based on 
         the comparison result.
       - Usage example: 
            {{#ifCond value1 value2}}
                <!-- Content if value1 equals value2 -->
            {{else}}
                <!-- Content if value1 does not equal value2 -->
            {{/ifCond}}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
*/

// Set up Handlebars view engine with custom helpers
//
app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (v1 === v2) {
                    return options.fn(this);
                }
                return options.inverse(this);
            },
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', './views');

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Middleware
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.use(
    session({
        secret: 'oneringtorulethemall',     // Secret key to sign the session ID cookie
        resave: false,                      // Don't save session if unmodified
        saveUninitialized: false,           // Don't create session until something stored
        cookie: { secure: false },          // True if using https. Set to false for development without https
    })
);

// Replace any of these variables below with constants for your application. These variables
// should be used in your template files. 
// 
app.use((req, res, next) => {
    res.locals.appName = 'MicroBlog';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

app.use(express.static('public'));                  // Serve static files
app.use(express.urlencoded({ extended: true }));    // Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.json());                            // Parse JSON bodies (as sent by API clients)

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Routes
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Home route: render home view with posts and user
// We pass the posts and user variables into the home
// template
//
app.get('/', async (req, res) => {
    const posts = await getPosts();
    const user = await getCurrentUser(req) || {};
    res.render('home', { posts, user });
});

// Redirect to Google's OAuth 2.0 server
app.get('/auth/google', (req, res) => {
    const url = client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
    });
    res.redirect(url);
});

// Handle OAuth 2.0 server response
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({
        auth: client,
        version: 'v2',
    });

    const userinfo = await oauth2.userinfo.get();
    const id = userinfo.data.id;
    const hash = crypto.createHash('sha256')
                    .update(id)
                    .digest('hex');
    req.session.userId = hash;
    const user = await findUserById(hash);
    //console.log(user);

    if (user) {
        //console.log("USER EXISTS");
        req.session.loggedIn = true;
        loginUser(req, res);
    } else {
        //console.log("USER DOESNT EXIST< GO TO REGISTER");
        res.redirect('../../register');
    }
});

// Register GET route is used for error response from registration
//
app.get('/register', (req, res) => {
    res.render('register', { regError: req.query.error });
});

// Login route GET route is used for error response from login
//
app.get('/login', (req, res) => {
    res.render('login', { loginError: req.query.error });
});

// Error route: render error page
//
app.get('/error', (req, res) => {
    res.render('error');
});

// Additional routes that you must implement

app.post('/posts', async (req, res) => {
    // TODO: Add a new post and redirect to home
    let body = req.body;
    addPost(body.title, body.content, await getCurrentUser(req));
    res.redirect('/');
});
app.post('/like/:id', (req, res) => {
    // TODO: Update post likes
    updatePostLikes(req, res);
});
app.get('/profile', isAuthenticated, (req, res) => {
    // TODO: Render profile page
    renderProfile(req, res);
});
app.get('/avatar/:username', (req, res) => {
    // TODO: Serve the avatar image for the user
    // Not In Use
    handleAvatar(req, res);
});
app.post('/register', (req, res) => {
    // TODO: Register a new user
    registerUser(req, res);
});
app.post('/login', (req, res) => {
    // TODO: Login a user
    loginUser(req, res);
});
app.get('/logout', (req, res) => {
    // TODO: Logout the user
    logoutUser(req, res);
});
app.post('/delete/:id', isAuthenticated, (req, res) => {
    // TODO: Delete a post if the current user is the owner
    deletePost(req,res);
});

app.get('/emojis', (req, res) => {
    //${accessToken}
    fetch(`https://emoji-api.com/emojis?access_key=${EMOJI_KEY}`)
    .then(response => response.json())
    .then(response => {res.send(response);})
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Server Activation
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function initializeDB() {
    db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            hashedGoogleId TEXT NOT NULL UNIQUE,
            avatar_url TEXT,
            memberSince DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            likes INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hashedGoogleId TEXT NOT NULL UNIQUE,
            postIds TEXT
        );
    `);
}

initializeDB().then(() =>{
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Error initializing database:', err);
});



//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Support Functions and Variables
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Example data for posts and users

/*
let posts = [
    { id: 1, title: 'Sample Post', content: 'This is a sample post.', username: 'SampleUser', timestamp: '2024-01-01 10:00', likes: 0 },
    { id: 2, title: 'Another Post', content: 'This is another sample post.', username: 'AnotherUser', timestamp: '2024-01-02 12:00', likes: 0 },
];

let users = [
    { id: 1, username: 'SampleUser', avatar_url: undefined, memberSince: '2024-01-01 08:00' },
    { id: 2, username: 'AnotherUser', avatar_url: undefined, memberSince: '2024-01-02 09:00' },
];*/
let userLikes = [
    // {userId :  // postIds: []}
];
// Function to find a user by username
async function findUserByUsername(username) {
    // TODO: Return user object if found, otherwise return undefined
    let data = undefined;
    const usersTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='users';`);
    if (usersTableExists) {
        //console.log('Users table exists.');
        const users = await db.all('SELECT * FROM users');
        if (users.length > 0) {
            users.forEach(user => {
                if (user.username == username) {
                    //console.log("Username Found");
                    data = {
                        username: user.username,
                        hashedGoogleId: user.hashedGoogleId,
                        avatar_url: user.avatar_url,
                        memberSince: user.memberSince

                    };
                }
            });
        } else {
            console.log('No users found.');
        }
    } else {
        console.log('Users table does not exist.');
    }
    return data;
}

// Function to find a user by user ID
async function findUserById(userId) {
    // TODO: Return user object if found, otherwise return undefined
    let data = undefined;
    const usersTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='users';`);
    if (usersTableExists) {
        //console.log('Users table exists.');
        const users = await db.all('SELECT * FROM users');
        if (users.length > 0) {
            users.forEach(user => {
                if (user.hashedGoogleId == userId) {
                    //console.log('GOOGLE ID FOUND');
                    data = {
                        username: user.username,
                        hashedGoogleId: user.hashedGoogleId,
                        avatar_url: user.avatar_url,
                        memberSince: user.memberSince

                    };
                }
            });
        } else {
            console.log('No users found.');
        }
    } else {
        console.log('Users table does not exist.');
    }
    return data;
}

// Function to add a new user
async function addUser(username, userId) {
    // TODO: Create a new user object and add to users array
    const currDate = new Date();
    let memberSince = ""+currDate.getFullYear()+"-"+currDate.getMonth()+"-"+currDate.getDate()+" "
    +String(currDate.getHours()).padStart(2,'0')+":"+String(currDate.getMinutes()).padStart(2,'0');
    
    await db.run(
        'INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince) VALUES (?, ?, ?, ?)',
        [username, userId, undefined, memberSince]
    );

    await db.run(
        'INSERT INTO likes (hashedGoogleId, postIds) VALUES (?, ?)',
        [userId, ""]
    );
}

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    //console.log(req.session.userId);
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Function to register a user
async function registerUser(req, res) {
    // TODO: Register a new user and redirect appropriately
    const username = req.body.username;
    const user = await findUserByUsername(username);
    if (user) {
        res.redirect('/register?error=Username+taken');
    } else {
        await addUser(username, req.session.userId);
        loginUser(req, res);
        //console.log("REGISTER COMPLETE");
    }
        
}

// Function to login a user
async function loginUser(req, res) {
    // TODO: Login a user and redirect appropriately
    req.session.loggedIn = true;
    handleAvatar(req, res);
    res.redirect('/');
}

// Function to logout a user
function logoutUser(req, res) {
    // TODO: Destroy session and redirect appropriately
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            res.direct('/error');
        } else {
            res.redirect('/');
        }
    });
}

// Function to render the profile page
async function renderProfile(req, res) {
    // TODO: Fetch user posts and render the profile page
    let user = await findUserById(req.session.userId);
    let userPosts = {};
    userPosts.posts = [];

    const postsTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts';`);
    if (postsTableExists) {
        //console.log('Posts table exists.');
        posts = await db.all('SELECT * FROM posts');
        if (posts.length > 0) {
            posts.forEach(post => {
                if (post.username == user.username){
                    userPosts.posts.push(post);
                }
            });
        } else {
            console.log('No posts found.');
        }
    } else {
        console.log('Posts table does not exist.');
    }
    res.render('profile', {userPosts:userPosts, user:user});
}

async function updateUserLikes(userId, post, res) {
    const likesTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='likes';`);
    if (likesTableExists) {
        //console.log('Posts table exists.');
        likes = await db.all('SELECT * FROM likes');
        if (likes.length > 0) {
            //console.log('Got Likes');
            likes.forEach(async (userLikes) => {
                if (userLikes.hashedGoogleId == userId) {
                    let postIds = userLikes.postIds;
                    console.log(postIds);
                    if (postIds.length == 0) {
                        console.log("LIKING POST");
                        await db.run(
                            `UPDATE likes SET postIds = ? WHERE id = ?`,
                            [userLikes.postIds+post.id+" ", userLikes.id]
                        );
                        await db.run(`UPDATE posts SET likes = ? WHERE id = ?`,
                            [post.likes+1, post.id]
                        );
                        res.send({likes: JSON.stringify(1)});
                    } else{
                        let foundPost = false
                        let newPostIds = '';
                        postIds.split(' ')
                        .forEach((id) => {
                            let intId = parseInt(id)
                            if (intId==post.id) {
                                foundPost = true
                            } else if (intId != NaN) {
                                newPostIds += id+' ';
                            }
                        });
                        if (foundPost) {
                            console.log("Remove ID: " + post.id);
                            await db.run(
                                `UPDATE likes SET postIds = ? WHERE id = ?`,
                                [newPostIds, userLikes.id]
                            );
                            await db.run(`UPDATE posts SET likes = ? WHERE id = ?`,
                                [post.likes-1, post.id]
                            );
                            res.send({likes: JSON.stringify(0)});
                        } else {
                            console.log("INCREMENT LIKES: " + post.likes+1);
                            await db.run(
                                `UPDATE likes SET postIds = ? WHERE id = ?`,
                                [userLikes.postIds+post.id+" ", userLikes.id]
                            );
                            await db.run(`UPDATE posts SET likes = ? WHERE id = ?`,
                                [post.likes+1, post.id]
                            );
                            res.send({likes: JSON.stringify(1)});
                        }
                    }
                }
            });
        } else {
            console.log('No posts found.');
        }
    } else {
        console.log('Posts table does not exist.');
    }
}
// Function to update post likes
async function updatePostLikes(req, res) {
    // TODO: Increment post likes if conditions are met
    let userId = req.session.userId;
    //console.log(userId);
    if (userId) {
        let postId = parseInt(req.body.id);
        //console.log("POSTID " + postId);
        const postsTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts';`);
        if (postsTableExists) {
            //console.log('Posts table exists.');
            posts = await db.all('SELECT * FROM posts');
            if (posts.length > 0) {
                posts.forEach(post => {
                    if (post.id == postId) {
                        //console.log("POST FOUND");
                        updateUserLikes(userId, post, res);
                    }
                });
            } else {
                console.log('No posts found.');
            }
        } else {
            console.log('Posts table does not exist.');
        }
    } else {
        res.send({redirect: '/login'});
    }
}

async function deletePost(req, res) {
    let userId = req.session.userId;
    if (userId) {
        let postId = parseInt(req.body.id);
        const likesTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='likes';`);
        if (likesTableExists) {
            likes = await db.all('SELECT * FROM likes');
            //console.log('Got Likes');
            likes.forEach(async (userLikes) => {
                let postIds = userLikes.postIds;
                let foundPost = false
                let newPostIds = '';
                postIds.split(' ')
                .forEach((id) => {
                    let intId = parseInt(id)
                    if (intId==postId) {
                        foundPost = true
                    } else if (intId != NaN) {
                        newPostIds += id+' ';
                    }
                });
                if (foundPost) {
                    await db.run(
                        `UPDATE likes SET postIds = ? WHERE id = ?`,
                        [newPostIds, userLikes.id]
                    );
                }
            });
        }
        await db.run(
            `DELETE FROM posts WHERE id = ?`,
            [postId]
        );
        res.send({deleted: 'deleted'});
    }
}

// Function to handle avatar generation and serving
async function handleAvatar(req, res) {
    // TODO: Generate and serve the user's avatar image
    let user = await getCurrentUser(req);
    //console.log("GET CURRENT USER: ");
    let username = user.username;
    let letter = String(username).charAt(0).toUpperCase();
    await db.run(`UPDATE users SET avatar_url = ? WHERE username = ?`,
        [generateAvatar(letter), username]
    );
}

// Function to get the current user from session
async function getCurrentUser(req) {
    // TODO: Return the user object if the session user ID matches
    const id = req.session.userId;
    
    if (id) {
        return await findUserById(id);
    } else {
        return undefined;
    }
}

// Function to get all posts, sorted by latest first
async function getPosts() {
    let posts = {};
    const postsTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts';`);
    if (postsTableExists) {
        //console.log('Posts table exists.');
        posts = await db.all('SELECT * FROM posts');
        if (posts.length > 0) {
            posts.forEach(post => {
                //console.log(post);
            });
        } else {
            console.log('No posts found.');
        }
    } else {
        console.log('Posts table does not exist.');
    }
    return posts.slice().reverse();
}

// Function to add a new post
async function addPost(title, content, user) {
    // TODO: Create a new post object and add to posts array
    const currDate = new Date();
    const timestamp = ""+currDate.getFullYear()+"-"+currDate.getMonth()+"-"+currDate.getDate()+" "
    +String(currDate.getHours()).padStart(2,'0')+":"+String(currDate.getMinutes()).padStart(2,'0');
    
    await db.run(
        'INSERT INTO posts (title, content, username, timestamp, likes) VALUES (?, ?, ?, ?, ?)',
        [title, content, user.username, timestamp, 0]
    );

    const postsTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts';`);
    if (postsTableExists) {
        //console.log('Posts table exists.');
        const posts = await db.all('SELECT * FROM posts');
        if (posts.length > 0) {
            posts.forEach(post => {
                console.log(post);
            });
        } else {
            console.log('No posts found.');
        }
    } else {
        console.log('Posts table does not exist.');
    }
}
const colors = [
    'red',
    'maroon',
    'blue',
    'aqua',
    'lime',
    'green',
    'purple',
    'orange'
];

// Function to generate an image avatar
function generateAvatar(letter, width = 100, height = 100) {
    // TODO: Generate an avatar image with a letter
    // Steps:
    // 1. Choose a color scheme based on the letter
    // 2. Create a canvas with the specified width and height
    // 3. Draw the background color
    // 4. Draw the letter in the center
    // 5. Return the avatar as a PNG buffer
    const avatar = canvas.createCanvas(width, height);
    const context = avatar.getContext('2d');
    let index = letter.charCodeAt(0) % colors.length;
    let color = colors[index];
    context.fillStyle = color;
    context.fillRect(0,0,width,height);
    context.fillStyle = 'white';
    context.font = '70px Verdana';
    context.textAlign = 'center';
    context.fillText(letter,50,75);
    
    const buffer = avatar.toBuffer('image/png');
    fs.writeFileSync('./public/images/avatar.png', buffer);
    return avatar.toDataURL();
}