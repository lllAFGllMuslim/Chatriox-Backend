const express = require('express');
const rateLimit = require('express-rate-limit');
const Job = require('../models/ScrapingJob');
const { auth } = require('../middleware/auth');
const { EnhancedBusinessScraper } = require('../services/ScraperService');

const router = express.Router();

// Rate limiting specific to scraper routes
const scraperLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many scraping requests from this IP, please try again later.'
});

// Global scraper instance
const scraper = new EnhancedBusinessScraper();

// Start scraping job
router.post('/start', auth, scraperLimiter, async (req, res) => {
  try {
    const { type, url, searchQuery, location, settings } = req.body;
    
    // Validation
    if (!type || !['website', 'business_search'].includes(type)) {
      return res.status(400).json({ error: 'Invalid scraping type' });
    }
    
    if (type === 'website' && !url) {
      return res.status(400).json({ error: 'URL is required for website scraping' });
    }
    
    if (type === 'business_search' && (!searchQuery || !location)) {
      return res.status(400).json({ error: 'Search query and location are required for business search' });
    }

    // Create job in database
    const jobData = {
      type,
      user: req.user.id,
      settings: settings || {}
    };

    if (type === 'website') {
      jobData.url = url;
    } else {
      jobData.searchQuery = searchQuery;
      jobData.location = location;
    }

    const job = new Job(jobData);
    await job.save();

    console.log(`🚀 Starting scraping job ${job._id} for user ${req.user.id}`);

    // Start scraping process asynchronously
    processScrapeJob(job._id, type, { url, searchQuery, location }, settings || {});

    res.json({
      success: true,
      jobId: job._id,
      message: 'Scraping job started successfully'
    });

  } catch (error) {
    console.error('❌ Error starting scraping job:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to start scraping job',
      message: error.message 
    });
  }
});

// Get all jobs for user
router.get('/jobs', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { user: req.user.id };
    if (status) {
      query.status = status;
    }

    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-results') // Exclude results for performance
      .exec();

    const total = await Job.countDocuments(query);

    res.json({
      success: true,
      data: jobs,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    console.error('❌ Error fetching jobs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch jobs',
      message: error.message 
    });
  }
});

// Get specific job details
router.get('/jobs/:jobId', auth, async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.jobId,
      user: req.user.id
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      data: job
    });

  } catch (error) {
    console.error('❌ Error fetching job details:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch job details',
      message: error.message 
    });
  }
});

// Cancel job
router.post('/jobs/:jobId/cancel', auth, async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.jobId,
      user: req.user.id
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'running' && job.status !== 'pending') {
      return res.status(400).json({ error: 'Job cannot be cancelled' });
    }

    job.status = 'cancelled';
    job.progress.currentStatus = 'Cancelled by user';
    await job.save();

    console.log(`🛑 Job ${job._id} cancelled by user ${req.user.id}`);

    res.json({
      success: true,
      message: 'Job cancelled successfully'
    });

  } catch (error) {
    console.error('❌ Error cancelling job:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to cancel job',
      message: error.message 
    });
  }
});

// Download job results as CSV
router.get('/jobs/:jobId/results', auth, async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.jobId,
      user: req.user.id
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'completed' || !job.results || job.results.length === 0) {
      return res.status(400).json({ error: 'No results available for download' });
    }

    // Generate CSV
    const csvHeaders = ['Email', 'Business Name', 'Phone', 'Address', 'Website', 'Rating', 'Source', 'Status'];
    const csvRows = job.results.map(result => [
      result.email || '',
      result.businessName || '',
      result.phone || '',
      result.address || '',
      result.website || '',
      result.rating || '',
      result.source || '',
      result.status || ''
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="scraping_results_${job._id}.csv"`);
    res.send(csvContent);

  } catch (error) {
    console.error('❌ Error downloading results:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to download results',
      message: error.message 
    });
  }
});

// Get scraper statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const stats = await Job.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalJobs: { $sum: 1 },
          completedJobs: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          runningJobs: {
            $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] }
          },
          totalEmails: { $sum: '$stats.withEmail' },
          totalPhones: { $sum: '$stats.withPhone' },
          totalBusinesses: { $sum: { $size: '$results' } }
        }
      }
    ]);

    const result = stats[0] || {
      totalJobs: 0,
      completedJobs: 0,
      runningJobs: 0,
      totalEmails: 0,
      totalPhones: 0,
      totalBusinesses: 0
    };

    res.json({
      success: true,
      stats: result
    });

  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message 
    });
  }
});

// Process scrape job asynchronously
async function processScrapeJob(jobId, type, params, settings) {
  let job;
  
  try {
    job = await Job.findById(jobId);
    if (!job) {
      console.error(`❌ Job ${jobId} not found`);
      return;
    }

    // Update job status to running
    job.status = 'running';
    job.progress.currentStatus = 'Starting scrape process...';
    job.progress.percentage = 5;
    await job.save();

    const startTime = Date.now();
    console.log(`🚀 Processing job ${jobId}: ${type}`);

    let results = [];

    if (type === 'website') {
      // Website scraping
      job.progress.currentStatus = 'Scraping website...';
      job.progress.percentage = 20;
      await job.save();

      const contactInfo = await scraper.scrapeContactFromWebsite(params.url);
      if (contactInfo.email || contactInfo.phone) {
        results.push({
          email: contactInfo.email || '',
          businessName: '',
          phone: contactInfo.phone || '',
          address: '',
          website: params.url,
          source: 'website_direct',
          status: 'valid'
        });
      }

    } else {
      // Business search
      job.progress.currentStatus = 'Searching Google Maps...';
      job.progress.percentage = 10;
      await job.save();

      // Launch parallel searches
      const searchPromises = [
        scraper.searchWithRetry(() => scraper.searchGoogleMaps(params.searchQuery, 
          [params.location.city, params.location.state, params.location.country].filter(Boolean).join(', '))),
        scraper.searchWithRetry(() => scraper.searchBusinessDirectory(params.searchQuery, 
          [params.location.city, params.location.state, params.location.country].filter(Boolean).join(', '))),
        scraper.searchWithRetry(() => scraper.searchYellowPages(params.searchQuery, 
          [params.location.city, params.location.state, params.location.country].filter(Boolean).join(', ')))
      ];

      job.progress.currentStatus = 'Searching multiple sources...';
      job.progress.percentage = 30;
      await job.save();

      const searchResults = await Promise.allSettled(searchPromises);
      let businesses = [];
      
      searchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          businesses = businesses.concat(result.value);
        }
      });

      job.progress.currentStatus = 'Deduplicating results...';
      job.progress.percentage = 60;
      await job.save();

      // Deduplicate
      const uniqueBusinesses = [];
      const seen = new Set();
      
      businesses.forEach((business) => {
        const nameKey = business.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const locationKey = business.address.toLowerCase().split(',')[0].replace(/[^a-z0-9]/g, '');
        const uniqueKey = `${nameKey}-${locationKey}`;
        
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          uniqueBusinesses.push({
            email: business.email || '',
            businessName: business.name || '',
            phone: business.phone || '',
            address: business.address || '',
            website: business.website || '',
            rating: business.rating || '',
            source: business.source || 'unknown',
            status: 'pending'
          });
        }
      });

      job.progress.currentStatus = 'Enhancing with website data...';
      job.progress.percentage = 80;
      await job.save();

      // Enhance top results
      const enhanceCount = Math.min(settings.maxResults || 10, uniqueBusinesses.length);
      for (let i = 0; i < enhanceCount; i++) {
        try {
          if (job.status === 'cancelled') break;
          
          const business = uniqueBusinesses[i];
          if (!business.email || !business.phone) {
            const enhanced = await scraper.enhanceWithWebsiteScraping({
              name: business.businessName,
              address: business.address,
              website: business.website
            });
            
            business.email = enhanced.email || business.email;
            business.phone = enhanced.phone || business.phone;
            business.website = enhanced.website || business.website;
          }
          business.status = 'valid';
        } catch (error) {
          console.error(`❌ Enhancement failed for business ${i}:`, error.message);
        }
      }

      results = uniqueBusinesses.slice(0, settings.maxResults || 100);
    }

    // Check if job was cancelled
    const updatedJob = await Job.findById(jobId);
    if (updatedJob.status === 'cancelled') {
      console.log(`🛑 Job ${jobId} was cancelled during processing`);
      return;
    }

    // Calculate statistics
    const withEmail = results.filter(r => r.email).length;
    const withPhone = results.filter(r => r.phone).length;
    const withBoth = results.filter(r => r.email && r.phone).length;

    // Update job with results
    job.status = 'completed';
    job.results = results;
    job.progress.percentage = 100;
    job.progress.currentStatus = 'Completed successfully';
    job.progress.emailsFound = withEmail;
    job.progress.phonesFound = withPhone;
    job.progress.businessesFound = results.length;
    job.stats = {
      withEmail,
      withPhone,
      withBoth,
      enhanced: type === 'business_search' ? Math.min(settings.maxResults || 10, results.length) : 0
    };
    job.sources = ['google_maps', 'bing_search', 'yellow_pages', 'website_enhancement'];
    job.duration = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    await job.save();

    console.log(`✅ Job ${jobId} completed successfully with ${results.length} results`);

  } catch (error) {
    console.error(`❌ Job ${jobId} failed:`, error.message);
    
    if (job) {
      job.status = 'failed';
      job.errorMessage = error.message;
      job.progress.currentStatus = 'Failed: ' + error.message;
      await job.save();
    }
  }
}

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Enhanced Business Scraper API is running',
    browserActive: scraper.browser !== null
  });
});

module.exports = router;