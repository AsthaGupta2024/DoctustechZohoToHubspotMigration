const axios = require('axios');
require('dotenv').config();

// Test configuration
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function testZohoUserSync() {
  console.log('🧪 Testing Zoho User Sync to HubSpot...');
  
  try {
    // Test the endpoint
    const response = await axios.get(`${BASE_URL}/zoho/users/sync`);
    
    console.log('✅ Test Result:');
    console.log('Status Code:', response.status);
    console.log('Response:', response.data);
    
    if (response.status === 200) {
      console.log('✅ Test PASSED: Successfully synced Zoho users to HubSpot');
    } else {
      console.log('❌ Test FAILED: Unexpected status code');
    }
  } catch (error) {
    console.error('❌ Test FAILED with error:');
    console.error('Status:', error.response?.status);
    console.error('Message:', error.response?.data || error.message);
  }
}

// Run the test
async function runTests() {
  // Make sure the server is running before testing
  console.log('⚠️ Make sure your server is running on port', PORT);
  console.log('Starting tests in 2 seconds...');
  
  setTimeout(async () => {
    await testZohoUserSync();
  }, 2000);
}

runTests();