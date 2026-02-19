require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY,

  waba: {
    token: process.env.WABA_TOKEN,
    phoneNumberId: process.env.WABA_PHONE_NUMBER_ID,
    verifyToken: process.env.WABA_VERIFY_TOKEN,
    apiVersion: process.env.WABA_API_VERSION || 'v21.0',
    get apiUrl() {
      return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;
    },
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxSize: 10 * 1024 * 1024, // 10MB
  },

  site: {
    name: process.env.SITE_NAME || 'Koperasi AI',
  },
};
