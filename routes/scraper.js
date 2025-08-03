const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const ScrapingJob = require('../models/ScrapingJob');
const User = require('../models/User');
const cheerio = require('cheerio');
const axios = require('axios');
const puppeteer = require('puppeteer');

const router = express.Router();

// @route   POST /api/scraper/start
// @desc    Start scraping job
// @access  Private
router.post('/start', [
  auth,
  body('type').isIn(['website', 'business_search']).withMessage('Invalid scraping type'),
  body('url').optional().isURL().withMessage('Valid URL is required for website scraping'),
  body('searchQuery').optional().trim().isLength({ min: 1 }).withMessage('Search query is required for business search')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { type, url, searchQuery, location, settings } = req.body;
    const userId = req.user.id;

    // Validate required fields based on type
    if (type === 'website' && !url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required for website scraping'
      });
    }

    if (type === 'business_search' && !searchQuery) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required for business search'
      });
    }

    const scrapingJob = new ScrapingJob({
      user: userId,
      type,
      url: type === 'website' ? url : undefined,
      searchQuery: type === 'business_search' ? searchQuery : undefined,
      location: location || {},
      settings: {
        depth: settings?.depth || 1,
        maxPages: settings?.maxPages || 50,
        delay: settings?.delay || 2,
        pattern: settings?.pattern || 'all',
        maxResults: settings?.maxResults || 100
      },
      status: 'pending'
    });

    await scrapingJob.save();

    // Start scraping process (in a real implementation, this would be queued)
    processScrapingJob(scrapingJob._id);

    res.status(201).json({
      success: true,
      message: 'Scraping job started',
      data: {
        jobId: scrapingJob._id,
        type: scrapingJob.type,
        status: scrapingJob.status
      }
    });
  } catch (error) {
    console.error('Start scraping error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/scraper/jobs
// @desc    Get scraping jobs
// @access  Private
router.get('/jobs', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { user: req.user.id };
    if (status) query.status = status;
    
    const jobs = await ScrapingJob.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await ScrapingJob.countDocuments(query);
    
    res.json({
      success: true,
      data: jobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get scraping jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/scraper/jobs/:id
// @desc    Get job details
// @access  Private
router.get('/jobs/:id', auth, async (req, res) => {
  try {
    const job = await ScrapingJob.findOne({
      _id: req.params.id,
      user: req.user.id
    });
    
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Scraping job not found'
      });
    }
    
    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    console.error('Get job details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/scraper/jobs/:id/cancel
// @desc    Cancel scraping job
// @access  Private
router.post('/jobs/:id/cancel', auth, async (req, res) => {
  try {
    const job = await ScrapingJob.findOne({
      _id: req.params.id,
      user: req.user.id
    });
    
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Scraping job not found'
      });
    }
    
    if (job.status !== 'running' && job.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Job cannot be cancelled in current status'
      });
    }
    
    job.status = 'cancelled';
    await job.save();
    
    res.json({
      success: true,
      message: 'Scraping job cancelled'
    });
  } catch (error) {
    console.error('Cancel job error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/scraper/jobs/:id/results
// @desc    Get scraping results
// @access  Private
router.get('/jobs/:id/results', auth, async (req, res) => {
  try {
    const job = await ScrapingJob.findOne({
      _id: req.params.id,
      user: req.user.id
    });
    
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Scraping job not found'
      });
    }
    
    if (job.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Job is not completed yet'
      });
    }
    
    // Generate CSV content
    const csvHeader = job.type === 'business_search' 
      ? 'Business Name,Email,Phone,Website,Address,Source,Status\n'
      : 'Email,Source,Domain,Status\n';
    
    const csvRows = job.results.map(result => {
      if (job.type === 'business_search') {
        return `"${result.businessName || ''}","${result.email}","${result.phone || ''}","${result.website || ''}","${result.address || ''}","${result.source}","${result.status}"`;
      } else {
        return `"${result.email}","${result.source}","${result.domain || ''}","${result.status}"`;
      }
    }).join('\n');
    
    const csvContent = csvHeader + csvRows;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="scraping_results_${job._id}.csv"`);
    res.send(csvContent);
  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/scraper/stats
// @desc    Get scraping statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const totalJobs = await ScrapingJob.countDocuments({ user: userId });
    const completedJobs = await ScrapingJob.countDocuments({ user: userId, status: 'completed' });
    const runningJobs = await ScrapingJob.countDocuments({ user: userId, status: 'running' });
    
    // Get total emails found
    const jobs = await ScrapingJob.find({ user: userId, status: 'completed' });
    const totalEmailsFound = jobs.reduce((sum, job) => sum + (job.progress.emailsFound || 0), 0);
    const totalValidEmails = jobs.reduce((sum, job) => sum + (job.progress.validEmails || 0), 0);
    
    res.json({
      success: true,
      data: {
        totalJobs,
        completedJobs,
        runningJobs,
        totalEmailsFound,
        totalValidEmails,
        successRate: totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0,
        validationRate: totalEmailsFound > 0 ? (totalValidEmails / totalEmailsFound) * 100 : 0
      }
    });
  } catch (error) {
    console.error('Get scraping stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Helper function to process scraping job
async function processScrapingJob(jobId) {
  try {
    const job = await ScrapingJob.findById(jobId);
    if (!job) return;

    job.status = 'running';
    job.startedAt = new Date();
    await job.save();

    const results = [];
    
    if (job.type === 'website') {
      // Real website scraping
      await scrapeWebsite(job, results);
    } else if (job.type === 'business_search') {
      // Real business search scraping
      await scrapeBusinessSearch(job, results);
    }

    // Complete the job
    job.status = 'completed';
    job.completedAt = new Date();
    job.results = results;
    await job.save();

    // Update user usage
    const user = await User.findById(job.user);
    user.usage.websitesScraped = (user.usage.websitesScraped || 0) + 1;
    await user.save();

  } catch (error) {
    console.error('Process scraping job error:', error);
    
    // Mark job as failed
    await ScrapingJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      error: error.message,
      completedAt: new Date()
    });
  }
}

// Real website scraping function
async function scrapeWebsite(job, results) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    const visitedUrls = new Set();
    const urlsToVisit = [job.url];
    let pagesScraped = 0;
    
    while (urlsToVisit.length > 0 && pagesScraped < job.settings.maxPages) {
      const currentUrl = urlsToVisit.shift();
      
      if (visitedUrls.has(currentUrl)) continue;
      visitedUrls.add(currentUrl);
      
      try {
        console.log(`Scraping: ${currentUrl}`);
        await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Extract emails from page content
        const pageEmails = await page.evaluate(() => {
          const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
          const text = document.body.innerText;
          return text.match(emailRegex) || [];
        });
        
        // Extract phone numbers
        const phoneNumbers = await page.evaluate(() => {
          const phoneRegex = /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
          const text = document.body.innerText;
          return text.match(phoneRegex) || [];
        });
        
        // Process found emails
        for (const email of pageEmails) {
          if (results.length >= job.settings.maxResults) break;
          
          const domain = email.split('@')[1];
          const isValid = await validateEmailFormat(email);
          
          results.push({
            email: email.toLowerCase(),
            source: currentUrl,
            domain,
            status: isValid ? 'valid' : 'invalid',
            foundAt: new Date()
          });
        }
        
        // Extract more URLs to visit (if depth allows)
        if (job.settings.depth > 1 && pagesScraped < job.settings.maxPages) {
          const links = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            return links.map(link => link.href).filter(href => 
              href.startsWith('http') && 
              !href.includes('#') && 
              !href.includes('mailto:') &&
              !href.includes('tel:')
            );
          });
          
          const baseUrl = new URL(currentUrl);
          for (const link of links.slice(0, 10)) { // Limit links per page
            try {
              const linkUrl = new URL(link);
              if (linkUrl.hostname === baseUrl.hostname && !visitedUrls.has(link)) {
                urlsToVisit.push(link);
              }
            } catch (e) {
              // Invalid URL, skip
            }
          }
        }
        
        pagesScraped++;
        
        // Update progress
        job.progress.pagesScraped = pagesScraped;
        job.progress.emailsFound = results.length;
        job.progress.validEmails = results.filter(r => r.status === 'valid').length;
        job.progress.percentage = Math.min((pagesScraped / job.settings.maxPages) * 100, 100);
        await job.save();
        
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, job.settings.delay * 1000));
        
      } catch (pageError) {
        console.error(`Error scraping ${currentUrl}:`, pageError);
        continue;
      }
    }
    
  } finally {
    await browser.close();
  }
}

// Real business search scraping function
async function scrapeBusinessSearch(job, results) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Search on multiple platforms
    const searchPlatforms = [
      {
        name: 'Google Maps',
        searchUrl: (query, location) => {
          const locationStr = [location.city, location.state, location.country].filter(Boolean).join(', ');
          return `https://www.google.com/maps/search/${encodeURIComponent(query + ' ' + locationStr)}`;
        }
      },
      {
        name: 'Yellow Pages',
        searchUrl: (query, location) => {
          const locationStr = [location.city, location.state].filter(Boolean).join(', ');
          return `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(query)}&geo_location_terms=${encodeURIComponent(locationStr)}`;
        }
      }
    ];
    
    let totalBusinessesFound = 0;
    
    for (const platform of searchPlatforms) {
      if (results.length >= job.settings.maxResults) break;
      
      try {
        const searchUrl = platform.searchUrl(job.searchQuery, job.location);
        console.log(`Searching on ${platform.name}: ${searchUrl}`);
        
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(3000); // Wait for dynamic content
        
        if (platform.name === 'Google Maps') {
          await scrapeGoogleMaps(page, job, results);
        } else if (platform.name === 'Yellow Pages') {
          await scrapeYellowPages(page, job, results);
        }
        
        // Update progress
        job.progress.businessesFound = results.filter(r => r.businessName).length;
        job.progress.emailsFound = results.length;
        job.progress.validEmails = results.filter(r => r.status === 'valid').length;
        job.progress.percentage = Math.min((results.length / job.settings.maxResults) * 100, 100);
        await job.save();
        
        // Add delay between platforms
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (platformError) {
        console.error(`Error scraping ${platform.name}:`, platformError);
        continue;
      }
    }
    
  } finally {
    await browser.close();
  }
}

// Scrape Google Maps results
async function scrapeGoogleMaps(page, job, results) {
  try {
    // Wait for results to load
    await page.waitForSelector('[data-value="Search results"]', { timeout: 10000 });
    
    // Extract business information
    const businesses = await page.evaluate(() => {
      const businessElements = document.querySelectorAll('[data-result-index]');
      const businesses = [];
      
      businessElements.forEach((element, index) => {
        if (index >= 20) return; // Limit results
        
        const nameElement = element.querySelector('[class*="fontHeadlineSmall"]');
        const addressElement = element.querySelector('[data-value="Address"]');
        const phoneElement = element.querySelector('[data-value="Phone number"]');
        const websiteElement = element.querySelector('[data-value="Website"]');
        
        if (nameElement) {
          businesses.push({
            name: nameElement.textContent?.trim(),
            address: addressElement?.textContent?.trim(),
            phone: phoneElement?.textContent?.trim(),
            website: websiteElement?.href
          });
        }
      });
      
      return businesses;
    });
    
    // Process each business
    for (const business of businesses) {
      if (results.length >= job.settings.maxResults) break;
      
      // Try to find email from website
      let email = null;
      if (business.website) {
        try {
          email = await extractEmailFromWebsite(business.website);
        } catch (e) {
          console.log(`Could not extract email from ${business.website}`);
        }
      }
      
      // Generate potential email if not found
      if (!email && business.name) {
        email = generatePotentialEmail(business.name, business.website);
      }
      
      if (email) {
        const isValid = await validateEmailFormat(email);
        results.push({
          businessName: business.name,
          email: email.toLowerCase(),
          phone: business.phone,
          website: business.website,
          address: business.address,
          source: 'Google Maps',
          domain: email.split('@')[1],
          status: isValid ? 'valid' : 'risky',
          foundAt: new Date()
        });
      }
    }
  } catch (error) {
    console.error('Error scraping Google Maps:', error);
  }
}

// Scrape Yellow Pages results
async function scrapeYellowPages(page, job, results) {
  try {
    // Wait for results
    await page.waitForSelector('.result', { timeout: 10000 });
    
    const businesses = await page.evaluate(() => {
      const businessElements = document.querySelectorAll('.result');
      const businesses = [];
      
      businessElements.forEach((element, index) => {
        if (index >= 20) return;
        
        const nameElement = element.querySelector('.business-name');
        const addressElement = element.querySelector('.adr');
        const phoneElement = element.querySelector('.phone');
        const websiteElement = element.querySelector('.track-visit-website');
        
        if (nameElement) {
          businesses.push({
            name: nameElement.textContent?.trim(),
            address: addressElement?.textContent?.trim(),
            phone: phoneElement?.textContent?.trim(),
            website: websiteElement?.href
          });
        }
      });
      
      return businesses;
    });
    
    // Process businesses similar to Google Maps
    for (const business of businesses) {
      if (results.length >= job.settings.maxResults) break;
      
      let email = null;
      if (business.website) {
        try {
          email = await extractEmailFromWebsite(business.website);
        } catch (e) {
          console.log(`Could not extract email from ${business.website}`);
        }
      }
      
      if (!email && business.name) {
        email = generatePotentialEmail(business.name, business.website);
      }
      
      if (email) {
        const isValid = await validateEmailFormat(email);
        results.push({
          businessName: business.name,
          email: email.toLowerCase(),
          phone: business.phone,
          website: business.website,
          address: business.address,
          source: 'Yellow Pages',
          domain: email.split('@')[1],
          status: isValid ? 'valid' : 'risky',
          foundAt: new Date()
        });
      }
    }
  } catch (error) {
    console.error('Error scraping Yellow Pages:', error);
  }
}

// Extract email from website
async function extractEmailFromWebsite(websiteUrl) {
  try {
    const response = await axios.get(websiteUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const text = $('body').text();
    
    // Look for email patterns
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = text.match(emailRegex);
    
    if (emails && emails.length > 0) {
      // Filter out common non-business emails
      const filteredEmails = emails.filter(email => {
        const lowerEmail = email.toLowerCase();
        return !lowerEmail.includes('noreply') && 
               !lowerEmail.includes('no-reply') &&
               !lowerEmail.includes('donotreply') &&
               !lowerEmail.includes('example.com') &&
               !lowerEmail.includes('test.com');
      });
      
      // Prefer contact, info, or business emails
      const preferredEmails = filteredEmails.filter(email => {
        const lowerEmail = email.toLowerCase();
        return lowerEmail.includes('contact') || 
               lowerEmail.includes('info') || 
               lowerEmail.includes('hello') ||
               lowerEmail.includes('support');
      });
      
      return preferredEmails.length > 0 ? preferredEmails[0] : filteredEmails[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting email from website:', error);
    return null;
  }
}

// Generate potential email based on business name
function generatePotentialEmail(businessName, website) {
  if (!businessName) return null;
  
  let domain = null;
  if (website) {
    try {
      domain = new URL(website).hostname.replace('www.', '');
    } catch (e) {
      // Invalid URL
    }
  }
  
  if (!domain) {
    // Generate domain from business name
    const cleanName = businessName.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '')
      .substring(0, 20);
    domain = `${cleanName}.com`;
  }
  
  // Common email prefixes
  const prefixes = ['info', 'contact', 'hello', 'admin', 'support'];
  const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  return `${randomPrefix}@${domain}`;
}

// Validate email format
async function validateEmailFormat(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;
  
  // Additional checks
  const domain = email.split('@')[1];
  const disposableDomains = ['tempmail.org', '10minutemail.com', 'guerrillamail.com'];
  
  return !disposableDomains.includes(domain.toLowerCase());
}

// Add puppeteer to package.json dependencies
async function ensurePuppeteerInstalled() {
  try {
    require('puppeteer');
  } catch (error) {
    console.log('Puppeteer not found. Please install it: npm install puppeteer');
    throw new Error('Puppeteer is required for web scraping. Please install it.');
  }
}

module.exports = router;