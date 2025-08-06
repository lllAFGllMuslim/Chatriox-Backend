const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');

// Enhanced user agents rotation
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
];

// Enhanced email and phone regex patterns
const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const phoneRegex = /(?:\+?1[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
const websiteRegex = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;

class EnhancedBusinessScraper {
  constructor() {
    this.browser = null;
    this.requestDelay = 2000;
  }

  getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  async randomDelay(min = 500, max = 1500) {
    const delay = Math.random() * (max - min) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async initBrowser() {
    if (!this.browser) {
      console.log('🚀 Launching browser...');
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-features=VizDisplayCompositor',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=site-per-process'
        ]
      });
      console.log('✅ Browser launched successfully');
    }
    return this.browser;
  }

  async setupPage(page) {
    console.log('⚙️  Setting up page...');
    
    const viewports = [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 1536, height: 864 }
    ];
    const viewport = viewports[Math.floor(Math.random() * viewports.length)];
    await page.setViewport(viewport);

    const userAgent = this.getRandomUserAgent();
    await page.setUserAgent(userAgent);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      delete window.navigator.webdriver;
    });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });
  }

  async searchGoogleMaps(query, location) {
    console.log('🗺️  Starting Google Maps search...');
    const browser = await this.initBrowser();
    const page = await browser.newPage();
    
    try {
      await this.setupPage(page);
      await this.randomDelay(1000, 2000);
      
      const searchQuery = `${query} in ${location}`;
      const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
      
      await page.goto(mapsUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.randomDelay(2000, 3000);
      
      try {
        await page.waitForSelector('[role="main"]', { timeout: 10000 });
      } catch (e) {
        console.log('⚠️  Results container not found, continuing anyway');
      }

      // Scroll to load more results
      await page.evaluate(() => {
        const scrollableDiv = document.querySelector('[role="main"]');
        if (scrollableDiv) {
          for (let i = 0; i < 3; i++) {
            scrollableDiv.scrollTop += 300;
          }
        }
      });

      await this.randomDelay(3000, 4000);

      const businesses = await page.evaluate(() => {
        const results = [];
        const containerSelectors = [
          'div[role="article"]',
          'div[data-result-index]',
          'div[jsaction*="pane.resultItem"]',
          'div[class*="result"]'
        ];
        
        let listings = [];
        for (const selector of containerSelectors) {
          listings = document.querySelectorAll(selector);
          if (listings.length > 0) break;
        }
        
        listings.forEach((listing, index) => {
          if (index >= 50) return;
          
          try {
            let name = '';
            const nameSelectors = [
              'h3[class*="fontHeadlineSmall"]',
              'div[class*="fontHeadlineSmall"]',
              'h3 span',
              '[data-value="Business name"]',
              'div[role="button"] span[style*="font-weight"]',
              'a[data-value="Business name"]',
              '.section-result-title',
              '.section-result-location'
            ];
            
            for (const selector of nameSelectors) {
              const nameEl = listing.querySelector(selector);
              if (nameEl && nameEl.textContent.trim()) {
                name = nameEl.textContent.trim();
                break;
              }
            }
            
            if (!name) {
              const headings = listing.querySelectorAll('h1, h2, h3, h4');
              for (const heading of headings) {
                if (heading.textContent.trim()) {
                  name = heading.textContent.trim();
                  break;
                }
              }
            }
            
            if (!name) return;
            
            let address = '';
            const addressSelectors = [
              '[data-value="Address"]',
              'div[style*="color:#70757a"]',
              'span[style*="color:#70757a"]',
              '.section-result-details',
              'div[class*="fontBodyMedium"]'
            ];
            
            for (const selector of addressSelectors) {
              const addressEl = listing.querySelector(selector);
              if (addressEl && addressEl.textContent.trim() && 
                  !addressEl.textContent.includes('★') &&
                  !addressEl.textContent.includes('$')) {
                address = addressEl.textContent.trim();
                break;
              }
            }
            
            let phone = '';
            const phoneSelectors = [
              '[data-value="Phone"]',
              'span[style*="color:#1a73e8"]',
              'button[data-value="Phone"]',
              'a[href^="tel:"]'
            ];
            
            for (const selector of phoneSelectors) {
              const phoneEl = listing.querySelector(selector);
              if (phoneEl) {
                if (phoneEl.href && phoneEl.href.startsWith('tel:')) {
                  phone = phoneEl.href.replace('tel:', '');
                } else if (phoneEl.textContent.trim()) {
                  phone = phoneEl.textContent.trim();
                }
                if (phone) break;
              }
            }
            
            let website = '';
            const websiteEl = listing.querySelector('a[href*="http"]:not([href*="google"]):not([href*="maps"])');
            if (websiteEl) {
              website = websiteEl.href;
            }
            
            let rating = '';
            const ratingEl = listing.querySelector('span[aria-label*="star"], span[role="img"][aria-label*="star"]');
            if (ratingEl) {
              rating = ratingEl.getAttribute('aria-label') || ratingEl.textContent.trim();
            }
            
            results.push({
              name: name,
              address: address || '',
              phone: phone || '',
              website: website || '',
              email: '',
              rating: rating || '',
              source: 'google_maps',
              mapUrl: window.location.href
            });
          } catch (e) {
            console.log(`Error extracting business ${index}:`, e.message);
          }
        });
        
        return results;
      });

      return businesses;
    } catch (error) {
      console.error('❌ Google Maps scraping error:', error.message);
      return [];
    } finally {
      await page.close();
    }
  }

  async searchBusinessDirectory(query, location) {
    console.log('📞 Starting enhanced directory search...');
    try {
      await this.randomDelay(500, 1500);
      
      const searchQueries = [
        `"${query}" "${location}" contact email phone`,
        `${query} ${location} "contact us" phone email`,
        `${query} near ${location} directory listing contact`
      ];
      
      let allBusinesses = [];
      
      for (const [index, searchQuery] of searchQueries.entries()) {
        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;
        const userAgent = this.getRandomUserAgent();
        
        try {
          const response = await axios.get(searchUrl, {
            headers: {
              'User-Agent': userAgent,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept-Encoding': 'gzip, deflate, br',
              'DNT': '1',
              'Connection': 'keep-alive',
              'Upgrade-Insecure-Requests': '1'
            },
            timeout: 15000
          });
          
          const $ = cheerio.load(response.data);
          const businesses = [];

          $('.b_algo, .b_topborder').each((resultIndex, element) => {
            if (resultIndex >= 30) return;
            
            const $el = $(element);
            const title = $el.find('h2 a, h3 a').text().trim();
            const snippet = $el.find('.b_caption p, .b_caption').text();
            const url = $el.find('h2 a, h3 a').attr('href');
            
            if (!title || !snippet) return;
            
            const emailMatches = (snippet + ' ' + title).match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || [];
            const phoneMatches = snippet.match(phoneRegex) || [];
            const websiteMatches = snippet.match(websiteRegex) || [];

            const validEmails = emailMatches.filter(email => 
              email &&
              email.length > 5 &&
              !email.toLowerCase().includes('noreply') && 
              !email.toLowerCase().includes('no-reply') &&
              !email.toLowerCase().includes('donotreply') &&
              !email.toLowerCase().includes('example.com') &&
              !email.toLowerCase().includes('test.com') &&
              !email.toLowerCase().includes('sample') &&
              !email.toLowerCase().includes('placeholder') &&
              /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/.test(email)
            );
            
            const validPhones = phoneMatches.filter(phone => {
              const cleaned = phone.replace(/\D/g, '');
              return cleaned.length >= 10 && cleaned.length <= 11;
            });
            
            if (title && (validEmails.length > 0 || validPhones.length > 0)) {
              const business = {
                name: title,
                address: location,
                phone: validPhones[0] || '',
                email: validEmails[0] || '',
                website: url || websiteMatches[0] || '',
                source: `bing_search_${index + 1}`,
                snippet: snippet.substring(0, 200)
              };
              
              businesses.push(business);
            }
          });

          allBusinesses = allBusinesses.concat(businesses);
          await this.randomDelay(1000, 2000);
          
        } catch (searchError) {
          console.error(`❌ Search ${index + 1} failed:`, searchError.message);
        }
      }

      return allBusinesses;
    } catch (error) {
      console.error('❌ Directory search error:', error.message);
      return [];
    }
  }

  async searchYellowPages(query, location) {
    console.log('📄 Starting Yellow Pages search...');
    const browser = await this.initBrowser();
    const page = await browser.newPage();
    
    try {
      await this.setupPage(page);
      
      const searchUrl = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(query)}&geo_location_terms=${encodeURIComponent(location)}`;
      
      await page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.randomDelay(2000, 3000);

      const businesses = await page.evaluate(() => {
        const results = [];
        const listings = document.querySelectorAll('.result, .search-results .result-item');
        
        listings.forEach((listing, index) => {
          if (index >= 30) return;
          
          try {
            const name = listing.querySelector('.business-name, h3 a, .n')?.textContent?.trim();
            const phone = listing.querySelector('.phones, .phone')?.textContent?.trim();
            const address = listing.querySelector('.address, .adr')?.textContent?.trim();
            const website = listing.querySelector('.track-visit-website')?.href;
            
            if (name && (phone || address)) {
              results.push({
                name,
                address: address || '',
                phone: phone || '',
                website: website || '',
                email: '',
                source: 'yellow_pages'
              });
            }
          } catch (e) {
            console.log(`Error extracting Yellow Pages listing ${index}:`, e.message);
          }
        });
        
        return results;
      });

      return businesses;
    } catch (error) {
      console.error('❌ Yellow Pages search error:', error.message);
      return [];
    } finally {
      await page.close();
    }
  }

  async enhanceWithWebsiteScraping(business) {
    if (business.email && business.phone) {
      return business;
    }
    
    const browser = await this.initBrowser();
    const page = await browser.newPage();
    
    try {
      await this.setupPage(page);
      
      if (business.website) {
        const contactInfo = await this.scrapeContactFromWebsite(business.website);
        if (contactInfo.email || contactInfo.phone) {
          return {
            ...business,
            email: contactInfo.email || business.email,
            phone: contactInfo.phone || business.phone
          };
        }
      }
      
      const searchQueries = [
        `"${business.name}" ${business.address} contact`,
        `"${business.name}" ${business.address.split(',')[0]} phone email`,
        `${business.name.split(' ')[0]} ${business.address.split(',')[0]} contact us`
      ];
      
      for (const searchQuery of searchQueries) {
        try {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
          
          await page.goto(searchUrl, {
            waitUntil: 'networkidle2',
            timeout: 20000
          });

          await this.randomDelay(500, 1000);

          const websiteUrls = await page.evaluate(() => {
            const results = [];
            const links = document.querySelectorAll('div[data-header-feature] a[href*="http"], h3 a[href*="http"]');
            
            for (let i = 0; i < Math.min(3, links.length); i++) {
              const url = links[i].href;
              if (!url.includes('google.com') && 
                  !url.includes('facebook.com') && 
                  !url.includes('youtube.com') &&
                  !url.includes('instagram.com') &&
                  !url.includes('linkedin.com') &&
                  !url.includes('twitter.com')) {
                results.push(url);
              }
            }
            return results;
          });

          for (const url of websiteUrls) {
            try {
              const contactInfo = await this.scrapeContactFromWebsite(url);
              if (contactInfo.email || contactInfo.phone) {
                return {
                  ...business,
                  email: contactInfo.email || business.email,
                  phone: contactInfo.phone || business.phone,
                  website: url
                };
              }
            } catch (error) {
              continue;
            }
          }
        } catch (searchError) {
          console.log(`❌ Website search failed:`, searchError.message);
        }
      }

      return business;
    } catch (error) {
      console.error(`❌ Website enhancement error for ${business.name}:`, error.message);
      return business;
    } finally {
      await page.close();
    }
  }

  async scrapeContactFromWebsite(url) {
    const browser = await this.initBrowser();
    const page = await browser.newPage();
    
    try {
      await this.setupPage(page);
      await this.randomDelay(300, 800);
      
      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 15000 
      });
      
      const contactPaths = [
        'a[href*="contact"]',
        'a[href*="Contact"]',
        'a[href*="about"]',
        'a[href*="About"]',
        'a[href*="team"]',
        'a[href*="staff"]',
        'a:contains("Contact")',
        'a:contains("About")',
        'a:contains("Get in touch")',
        'a:contains("Reach us")',
        'a:contains("Email us")',
        '.contact-link',
        '.contact-btn'
      ];
      
      for (const selector of contactPaths) {
        try {
          const contactLink = await page.$(selector);
          if (contactLink) {
            await Promise.race([
              contactLink.click(),
              new Promise(resolve => setTimeout(resolve, 5000))
            ]);
            await page.waitForNavigation({ 
              waitUntil: 'networkidle2', 
              timeout: 10000 
            }).catch(() => {});
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      const contactInfo = await page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        const bodyHTML = document.body.innerHTML || '';
        const combinedContent = bodyText + ' ' + bodyHTML;
        
        const emailPatterns = [
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
          /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
          /email[:\s]*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
          /contact[:\s]*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
          /reach us[:\s]*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi
        ];
        
        let allEmails = [];
        
        emailPatterns.forEach(pattern => {
          let matches = combinedContent.match(pattern);
          if (matches) {
            matches.forEach(match => {
              const emailMatch = match.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/);
              if (emailMatch) {
                allEmails.push(emailMatch[1]);
              }
            });
          }
        });
        
        const phonePatterns = [
          /(?:\+?1[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
          /phone[:\s]*(\+?1?[-.\s]?\(?[2-9][0-9]{2}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/gi,
          /call[:\s]*(\+?1?[-.\s]?\(?[2-9][0-9]{2}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/gi,
          /tel[:\s]*(\+?1?[-.\s]?\(?[2-9][0-9]{2}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/gi
        ];
        
        let allPhones = [];
        
        phonePatterns.forEach(pattern => {
          let matches = combinedContent.match(pattern);
          if (matches) {
            matches.forEach(match => {
              const phoneMatch = match.match(/(\+?1?[-.\s]?\(?[2-9][0-9]{2}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/);
              if (phoneMatch) {
                allPhones.push(phoneMatch[1]);
              }
            });
          }
        });
        
        const validEmails = [...new Set(allEmails)]
          .filter(email => 
            email && 
            email.length > 5 &&
            email.includes('.') &&
            !email.toLowerCase().includes('noreply') && 
            !email.toLowerCase().includes('no-reply') &&
            !email.toLowerCase().includes('donotreply') &&
            !email.toLowerCase().includes('example.com') &&
            !email.toLowerCase().includes('test.com') &&
            !email.toLowerCase().includes('placeholder') &&
            !email.toLowerCase().includes('your-email') &&
            !email.toLowerCase().includes('youremail') &&
            !email.toLowerCase().includes('sample') &&
            /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/.test(email)
          )
          .slice(0, 5);
        
        const validPhones = [...new Set(allPhones)]
          .filter(phone => {
            const cleaned = phone.replace(/\D/g, '');
            return cleaned.length >= 10 && cleaned.length <= 11 && cleaned !== '1234567890';
          })
          .slice(0, 3);
        
        return {
          email: validEmails[0] || null,
          phone: validPhones[0] || null,
          allEmails: validEmails,
          allPhones: validPhones
        };
      });

      return contactInfo;
    } catch (error) {
      console.error(`❌ Failed to scrape contact from ${url}:`, error.message);
      return { email: null, phone: null };
    } finally {
      await page.close();
    }
  }

  async searchWithRetry(searchFunction, maxRetries = 2) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.randomDelay(i * 1000, (i + 1) * 1500);
        const result = await searchFunction();
        if (result && result.length > 0) {
          return result;
        }
      } catch (error) {
        if (i === maxRetries - 1) {
          throw error;
        }
        await this.randomDelay(2000, 4000);
      }
    }
    return [];
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = { EnhancedBusinessScraper };