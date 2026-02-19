const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');

const config = require('./config');

const app = express();

// Trust proxy (Cloudflare Tunnel / reverse proxy)
app.set('trust proxy', 1);

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Global template variables
app.use((req, res, next) => {
  res.locals.siteName = config.site.name;
  res.locals.currentPath = req.path;
  res.locals.user = req.user || null;
  next();
});

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const apiRoutes = require('./routes/api');
const webhookRoutes = require('./routes/webhook');

app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/api', apiRoutes);
app.use('/webhook', webhookRoutes);

// Root redirect
app.get('/', (req, res) => res.redirect('/auth/login'));

// 404
app.use((req, res) => {
  res.status(404).render('errors/404', { layout: false });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('errors/500', { layout: false, error: err.message });
});

module.exports = app;
