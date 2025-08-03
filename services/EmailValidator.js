// emailValidator.js - Improved version with better SMTP handling
const dns = require('dns').promises;
const net = require('net');
const os = require('os');

class EmailValidator {
  constructor(options = {}) {
    this.timeout = options.timeout || 10000; // Increased timeout to 10 seconds
    this.retryAttempts = options.retryAttempts || 2; // Increased retries
    this.fromEmail = options.fromEmail || 'test@example.com';
    this.verbose = options.verbose || false;
    
    // More conservative SMTP validation approach
    this.skipSMTPValidation = options.skipSMTPValidation || false;
    this.treatGreylistingAsValid = options.treatGreylistingAsValid || true;
    
    // Known disposable email domains
    this.disposableDomains = new Set([
      '10minutemail.com', '20minutemail.com', 'guerrillamail.com',
      'mailinator.com', 'tempmail.org', 'temp-mail.org', 'yopmail.com',
      'throwaway.email', 'maildrop.cc', 'trashmail.com', 'dispostable.com',
      'mailnesia.com', 'spamgourmet.com', 'mohmal.com', 'sharklasers.com',
      'grr.la', 'guerrillamailblock.com', 'pokemail.net', 'spam4.me',
      'tempail.com', 'tempemail.com', 'tempinbox.com', 'emailondeck.com',
      'getnada.com', 'harakirimail.com', 'mytrashmail.com', 'mailcatch.com'
    ]);
    
    // Common role-based email prefixes
    this.roleBasedPrefixes = new Set([
      'admin', 'administrator', 'support', 'help', 'info', 'contact',
      'sales', 'marketing', 'billing', 'accounts', 'no-reply', 'noreply',
      'webmaster', 'postmaster', 'hostmaster', 'abuse', 'security',
      'privacy', 'legal', 'compliance', 'hr', 'recruiting', 'careers'
    ]);
  }

  async validateEmail(email) {
    const startTime = Date.now();
    const result = {
      email: email,
      isValid: false,
      checks: {
        syntax: { passed: false, message: '' },
        domain: { passed: false, message: '' },
        mx: { passed: false, message: '', records: [] },
        smtp: { passed: false, message: '', response: '', skipped: false },
        disposable: { passed: true, message: '' },
        roleBased: { passed: true, message: '' }
      },
      executionTime: 0,
      timestamp: new Date().toISOString()
    };

    try {
      this.log(`Starting validation for: ${email}`);

      // 1. Syntax validation
      const syntaxResult = this.validateSyntax(email);
      result.checks.syntax = syntaxResult;
      if (!syntaxResult.passed) {
        result.executionTime = Date.now() - startTime;
        return result;
      }

      const { localPart, domain } = this.parseEmail(email);

      // 2. Domain validation with timeout
      const domainResult = await this.withTimeout(
        this.validateDomain(domain),
        5000, // 5 second timeout for domain lookup
        'Domain lookup timeout'
      );
      result.checks.domain = domainResult;
      if (!domainResult.passed) {
        result.executionTime = Date.now() - startTime;
        return result;
      }

      // 3. MX record validation with timeout
      const mxResult = await this.withTimeout(
        this.validateMX(domain),
        5000, // 5 second timeout for MX lookup
        'MX record lookup timeout'
      );
      result.checks.mx = mxResult;
      if (!mxResult.passed) {
        result.executionTime = Date.now() - startTime;
        return result;
      }

      // 4. SMTP validation with improved handling
      if (this.skipSMTPValidation) {
        result.checks.smtp = {
          passed: true,
          message: 'SMTP validation skipped',
          response: '',
          skipped: true
        };
      } else {
        const smtpResult = await this.withTimeout(
          this.validateSMTP(email, mxResult.records),
          this.timeout,
          'SMTP validation timeout'
        );
        result.checks.smtp = smtpResult;
      }

      // 5. Disposable email check
      const disposableResult = this.checkDisposable(domain);
      result.checks.disposable = disposableResult;

      // 6. Role-based email check
      const roleBasedResult = this.checkRoleBased(localPart);
      result.checks.roleBased = roleBasedResult;

      // Determine overall validity - more lenient approach
      result.isValid = result.checks.syntax.passed && 
                      result.checks.domain.passed && 
                      result.checks.mx.passed && 
                      (result.checks.smtp.passed || result.checks.smtp.skipped);

      result.executionTime = Date.now() - startTime;
      this.log(`Validation completed in ${result.executionTime}ms`);
      
      return result;

    } catch (error) {
      this.log(`Validation error: ${error.message}`);
      result.checks.syntax.message = `Validation error: ${error.message}`;
      result.executionTime = Date.now() - startTime;
      return result;
    }
  }

  // Helper method to add timeout to any promise
  async withTimeout(promise, timeoutMs, timeoutMessage) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } catch (error) {
      if (error.message === timeoutMessage) {
        return {
          passed: false,
          message: timeoutMessage,
          records: []
        };
      }
      throw error;
    }
  }

  validateSyntax(email) {
    if (!email || typeof email !== 'string') {
      return { passed: false, message: 'Email is required and must be a string' };
    }
    
    email = email.trim();
    
    if (email.length === 0) {
      return { passed: false, message: 'Email cannot be empty' };
    }
    
    const atSymbols = (email.match(/@/g) || []).length;
    if (atSymbols !== 1) {
      return { passed: false, message: 'Email must contain exactly one @ symbol' };
    }
    
    const [localPart, domain] = email.split('@');
    
    if (!localPart || localPart.length === 0 || localPart.length > 64) {
      return { passed: false, message: 'Local part must be 1-64 characters' };
    }
    
    if (!domain || domain.length === 0 || domain.length > 253) {
      return { passed: false, message: 'Domain part must be 1-253 characters' };
    }
    
    // More permissive regex that handles international domains better
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    
    if (!emailRegex.test(email)) {
      return { passed: false, message: 'Email format is invalid according to RFC 5322' };
    }
    
    if (localPart.startsWith('.') || localPart.endsWith('.')) {
      return { passed: false, message: 'Local part cannot start or end with a period' };
    }
    
    if (localPart.includes('..')) {
      return { passed: false, message: 'Local part cannot contain consecutive periods' };
    }
    
    if (domain.startsWith('-') || domain.endsWith('-')) {
      return { passed: false, message: 'Domain cannot start or end with a hyphen' };
    }
    
    return { passed: true, message: 'Email syntax is valid' };
  }

  async validateDomain(domain) {
    try {
      await dns.lookup(domain);
      return { passed: true, message: 'Domain exists and is resolvable' };
    } catch (error) {
      return { 
        passed: false, 
        message: `Domain lookup failed: ${error.code || error.message}` 
      };
    }
  }

  async validateMX(domain) {
    try {
      const mxRecords = await dns.resolveMx(domain);
      if (!mxRecords || mxRecords.length === 0) {
        return { 
          passed: false, 
          message: 'No MX records found for domain',
          records: []
        };
      }
      
      const sortedRecords = mxRecords.sort((a, b) => a.priority - b.priority);
      return {
        passed: true,
        message: `Found ${sortedRecords.length} MX record(s)`,
        records: sortedRecords
      };
    } catch (error) {
      return {
        passed: false,
        message: `MX record lookup failed: ${error.code || error.message}`,
        records: []
      };
    }
  }

  async validateSMTP(email, mxRecords) {
    let lastError = null;
    
    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      for (const mx of mxRecords.slice(0, 3)) { // Only try first 3 MX records
        try {
          this.log(`SMTP attempt ${attempt + 1} for ${mx.exchange}`);
          const result = await this.performSMTPCheck(email, mx.exchange);
          
          // Consider these as "passed" or acceptable
          if (result.passed) {
            return result;
          }
          
          // Handle greylisting as valid if configured to do so
          if (this.treatGreylistingAsValid && this.isGreylisting(result.message)) {
            return {
              passed: true,
              message: `Email accepted (greylisting detected): ${result.message}`,
              response: result.response
            };
          }
          
          // If we get a definitive rejection, don't try other servers
          if (this.isDefinitiveRejection(result.message)) {
            return result;
          }
          
          lastError = result;
          
        } catch (error) {
          this.log(`SMTP check failed for ${mx.exchange}: ${error.message}`);
          lastError = {
            passed: false,
            message: `SMTP error: ${error.message}`,
            response: ''
          };
          continue;
        }
      }
      
      if (attempt < this.retryAttempts - 1) {
        await this.sleep(1000); // Longer delay between attempts
      }
    }
    
    // If we couldn't get a definitive answer, be more lenient
    return lastError || {
      passed: false,
      message: 'SMTP validation failed for all MX servers after retries',
      response: ''
    };
  }

  isGreylisting(message) {
    const greylistingIndicators = [
      'greylisted', 'greylist', 'try again later', 'temporary failure',
      'deferred', 'rate limit', 'throttl', '450', '451', '452'
    ];
    
    const lowerMessage = message.toLowerCase();
    return greylistingIndicators.some(indicator => lowerMessage.includes(indicator));
  }

  isDefinitiveRejection(message) {
    const rejectionIndicators = [
      'user unknown', 'mailbox unavailable', 'address not found',
      'recipient not found', 'no such user', 'invalid recipient',
      '550', '551', '553'
    ];
    
    const lowerMessage = message.toLowerCase();
    return rejectionIndicators.some(indicator => lowerMessage.includes(indicator));
  }

  async performSMTPCheck(email, mxServer) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let response = '';
      let step = 0;
      let resolved = false;
      
      const resolveOnce = (result) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      const rejectOnce = (error) => {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      };

      // Set socket timeout
      socket.setTimeout(this.timeout);

      // Set up timeout handling
      const connectionTimeout = setTimeout(() => {
        if (!resolved) {
          this.log(`Connection timeout for ${mxServer}`);
          socket.destroy();
          resolveOnce({
            passed: false,
            message: `Connection timeout to ${mxServer}`,
            response: response.trim()
          });
        }
      }, this.timeout);

      const cleanup = () => {
        clearTimeout(connectionTimeout);
        if (!socket.destroyed) {
          socket.end();
          setTimeout(() => {
            if (!socket.destroyed) {
              socket.destroy();
            }
          }, 200);
        }
      };

      // Connection handling
      socket.connect(25, mxServer, () => {
        this.log(`Connected to ${mxServer}:25`);
      });

      socket.on('data', (data) => {
        if (resolved) return;

        const message = data.toString().trim();
        response += message + '\n';
        this.log(`SMTP Response (step ${step}): ${message}`);
        
        // Handle multi-line responses
        const lines = message.split('\r\n').filter(line => line.length > 0);
        const lastLine = lines[lines.length - 1];
        const code = parseInt(lastLine.substring(0, 3));
        
        // Check if this is the end of a multi-line response
        if (lastLine.length > 3 && lastLine[3] === '-') {
          return;
        }
        
        try {
          switch (step) {
            case 0: // Server greeting
              if (code === 220) {
                socket.write(`HELO ${os.hostname()}\r\n`);
                step++;
              } else {
                cleanup();
                resolveOnce({
                  passed: false,
                  message: `Connection rejected: ${lastLine}`,
                  response: response.trim()
                });
              }
              break;
              
            case 1: // HELO response
              if (code === 250) {
                socket.write(`MAIL FROM:<${this.fromEmail}>\r\n`);
                step++;
              } else {
                cleanup();
                resolveOnce({
                  passed: false,
                  message: `HELO rejected: ${lastLine}`,
                  response: response.trim()
                });
              }
              break;
              
            case 2: // MAIL FROM response
              if (code === 250) {
                socket.write(`RCPT TO:<${email}>\r\n`);
                step++;
              } else {
                cleanup();
                resolveOnce({
                  passed: false,
                  message: `MAIL FROM rejected: ${lastLine}`,
                  response: response.trim()
                });
              }
              break;
              
            case 3: // RCPT TO response - this is what we care about
              socket.write('QUIT\r\n');
              cleanup();
              
              if (code === 250) {
                resolveOnce({
                  passed: true,
                  message: 'Email address accepted by SMTP server',
                  response: response.trim()
                });
              } else if (code === 550 || code === 551 || code === 553) {
                resolveOnce({
                  passed: false,
                  message: `Email address rejected: ${lastLine}`,
                  response: response.trim()
                });
              } else if (code === 450 || code === 451 || code === 452) {
                // Treat temporary failures more leniently
                resolveOnce({
                  passed: this.treatGreylistingAsValid,
                  message: `Temporary failure (greylisting/rate limiting): ${lastLine}`,
                  response: response.trim()
                });
              } else {
                resolveOnce({
                  passed: false,
                  message: `Unexpected response: ${lastLine}`,
                  response: response.trim()
                });
              }
              break;
          }
        } catch (error) {
          cleanup();
          resolveOnce({
            passed: false,
            message: `Protocol error: ${error.message}`,
            response: response.trim()
          });
        }
      });

      socket.on('error', (error) => {
        this.log(`SMTP socket error for ${mxServer}: ${error.message}`);
        cleanup();
        if (!resolved) {
          resolveOnce({
            passed: false,
            message: `Connection error: ${error.message}`,
            response: response.trim()
          });
        }
      });

      socket.on('timeout', () => {
        this.log(`SMTP socket timeout for ${mxServer}`);
        cleanup();
        if (!resolved) {
          resolveOnce({
            passed: false,
            message: `Socket timeout for ${mxServer}`,
            response: response.trim()
          });
        }
      });

      socket.on('close', (hadError) => {
        cleanup();
        if (!resolved) {
          resolveOnce({
            passed: false,
            message: hadError ? 'Connection closed with error' : 'Connection closed unexpectedly',
            response: response.trim()
          });
        }
      });

      socket.on('end', () => {
        cleanup();
        if (!resolved) {
          resolveOnce({
            passed: false,
            message: 'Connection ended by server',
            response: response.trim()
          });
        }
      });
    });
  }

  checkDisposable(domain) {
    const isDisposable = this.disposableDomains.has(domain.toLowerCase());
    return {
      passed: !isDisposable,
      message: isDisposable ? 'Domain is a known disposable email provider' : 'Domain is not a disposable email provider'
    };
  }

  checkRoleBased(localPart) {
    const isRoleBased = this.roleBasedPrefixes.has(localPart.toLowerCase());
    return {
      passed: !isRoleBased,
      message: isRoleBased ? 'Email appears to be role-based (non-personal)' : 'Email appears to be personal (not role-based)'
    };
  }

  parseEmail(email) {
    const [localPart, domain] = email.split('@');
    return { localPart, domain };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  log(message) {
    if (this.verbose) {
      console.log(`[EmailValidator] ${new Date().toISOString()} - ${message}`);
    }
  }

  async validateBatch(emails) {
    const results = [];
    for (const email of emails) {
      const result = await this.validateEmail(email);
      results.push(result);
    }
    return results;
  }

  exportToJSON(results, filename = null) {
    const json = JSON.stringify(results, null, 2);
    if (filename) {
      require('fs').writeFileSync(filename, json);
      console.log(`Results exported to ${filename}`);
    }
    return json;
  }
}

module.exports = EmailValidator;