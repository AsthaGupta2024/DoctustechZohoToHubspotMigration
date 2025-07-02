// require('dotenv').config();
// const axios = require('axios');

// // Zoho Configuration
// const ZOHO_ACCESS_TOKEN = process.env.ZOHO_CLIENT_SECRET;
// const ZOHO_MODULE = process.env.ZOHO_MODULE || 'Deals'; // Contacts, Leads, Deals, etc.
// const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com'; // or .eu, .in, .com.au based on your data center

// // HubSpot Configuration
// const HUBSPOT_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
// const HUBSPOT_OBJECT_TYPE = process.env.HUBSPOT_OBJECT_TYPE || 'deals';
// const HUBSPOT_API = 'https://api.hubapi.com';

// // Field type mapping from Zoho to HubSpot
// const getHubSpotFieldType = (zohoFieldType) => {
//   switch (zohoFieldType.toLowerCase()) {
//     case 'picklist':
//     case 'multiselectpicklist':
//       return 'enumeration';
//     default:
//       return 'string'; // Rich text field
//   }
// };

// // Get custom properties from Zoho
// async function getZohoCustomProperties() {
//   const url = `${ZOHO_API_DOMAIN}/crm/v3/settings/fields?module=${ZOHO_MODULE}`;
  
//   try {
//     const response = await axios.get(url, {
//       headers: {
//         'Authorization': `Zoho-oauthtoken 1000.f8a43fb29fddb441c03442abd9152e54.bb7c6b4aecad408f5c850eb51a9b5c33`,
//         'Content-Type': 'application/json'
//       }
//     });

//     // // Filter only custom fields (not system fields)
//     // const customFields = response.data.fields.filter(field => 
//     //   field.custom_field === true && 
//     //   field.api_name !== 'id' // Exclude ID field
//     // );

//      const zohoContactProperties = [
//     "First Name",
//     "Last Name",
//     "Name Prefix",
//     "Account Name",
//     "Title",
//     "Email",
//     "Phone",
//     "Mobile Phone",
//     "Fax",
//     "Twitter Username",
//     "Mailing Street",
//     "Mailing City",
//     "Mailing Zip",
//     "Mailing State",
//     "Mailing Country",
//     "Account",
//     "Contact Owner"
//   ];

//     const allFields = response.data.fields || [];

//     // Filter out fields whose field_label is in the zohoContactProperties list
//     const customFields = allFields.filter(
//       field => !zohoContactProperties.includes(field.field_label)
//     );

    

//     console.log(`Found ${customFields.length} custom fields in Zoho ${ZOHO_MODULE} module.`);
//     return customFields;
//   } catch (error) {
//     console.error('Error fetching Zoho properties:', error.response?.data || error.message);
//     throw error;
//   }
// }

// // Transform Zoho field to HubSpot property format
// function transformZohoFieldToHubSpot(zohoField) {
//   const hubspotFieldType = getHubSpotFieldType(zohoField.data_type);
  
//   const hubspotProperty = {
//     name: zohoField.api_name.toLowerCase(), // HubSpot prefers lowercase
//     label: zohoField.display_label || zohoField.field_label,
//     type: hubspotFieldType,
//     fieldType: hubspotFieldType === 'enumeration' ? 'select' : 'textarea', // select for dropdown, textarea for rich text
//     groupName: 'zohoinformation', // Default group, adjust as needed
//     description: zohoField.tooltip?.name || `Migrated from Zoho: ${zohoField.display_label}`,
//   };

//   // Add options for dropdown fields
//   if (hubspotFieldType === 'enumeration' && zohoField.pick_list_values) {
//     hubspotProperty.options = zohoField.pick_list_values.map(option => ({
//       label: option.display_value,
//       value: option.actual_value,
//       description: option.display_value,
//       displayOrder: option.sequence_number || 0
//     }));
//   }

//   // Handle multiple select fields
//   if (zohoField.data_type.toLowerCase() === 'multiselectpicklist') {
//     hubspotProperty.fieldType = 'checkbox'; // Use checkbox for multiple selections
//   }

//   return hubspotProperty;
// }

// // Create property in HubSpot
// async function createHubSpotProperty(property) {
//   const url = `${HUBSPOT_API}/crm/v3/properties/${HUBSPOT_OBJECT_TYPE}`;
  
//   try {
//     const response = await axios.post(url, property, {
//       headers: {
//         'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
//         'Content-Type': 'application/json'
//       }
//     });
    
//     console.log(`✅ Created property: ${property.name} (${property.fieldType})`);
//     return response.data;
//   } catch (error) {
//     if (error.response?.status === 409) {
//       console.log(`⚠️  Property already exists: ${property.name}`);
//     } else {
//       console.error(`❌ Failed to create property: ${property.name}`, 
//         error.response?.data?.message || error.message);
//     }
//     throw error;
//   }
// }

// // Check if property already exists in HubSpot
// async function getExistingHubSpotProperties() {
//   const url = `${HUBSPOT_API}/crm/v3/properties/${HUBSPOT_OBJECT_TYPE}`;
  
//   try {
//     const response = await axios.get(url, {
//       headers: {
//         'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`
//       }
//     });
    
//     return response.data.results.map(prop => prop.name);
//   } catch (error) {
//     console.error('Error fetching existing HubSpot properties:', error.response?.data || error.message);
//     return [];
//   }
// }

// // // Main migration function
// async function migrateProperties() {
//   try {
//     console.log('🚀 Starting Zoho to HubSpot property migration...\n');
    
//     // Get existing HubSpot properties to avoid duplicates
//     console.log('📋 Fetching existing HubSpot properties...');
//     const existingProperties = await getExistingHubSpotProperties();
//     console.log(`Found ${existingProperties.length} existing properties in HubSpot.\n`);
    
//     // Get custom properties from Zoho
//     console.log('📥 Fetching custom properties from Zoho...');
//     const zohoProperties = await getZohoCustomProperties();
    
//     if (zohoProperties.length === 0) {
//       console.log('No custom properties found in Zoho. Migration complete.');
//       return;
//     }
    
//     console.log('\n🔄 Processing properties...\n');
    
//     let created = 0;
//     let skipped = 0;
//     let failed = 0;
    
//     for (const zohoField of zohoProperties) {
//       try {
//         const hubspotProperty = transformZohoFieldToHubSpot(zohoField);
        
//         // Check if property already exists
//         if (existingProperties.includes(hubspotProperty.name)) {
//           console.log(`⏭️  Skipping existing property: ${hubspotProperty.name}`);
//           skipped++;
//           continue;
//         }
        
//         // Create property in HubSpot
//         await createHubSpotProperty(hubspotProperty);
//         created++;
        
//         // Add small delay to avoid rate limiting
//         await new Promise(resolve => setTimeout(resolve, 100));
        
//       } catch (error) {
//         failed++;
//         console.error(`Error processing field: ${zohoField.api_name}`, error.message);
//       }
//     }
    
//     console.log('\n📊 Migration Summary:');
//     console.log(`✅ Created: ${created}`);
//     console.log(`⏭️  Skipped: ${skipped}`);
//     console.log(`❌ Failed: ${failed}`);
//     console.log(`📝 Total processed: ${zohoProperties.length}`);
//     console.log('\n🎉 Property migration complete!');
    
//   } catch (error) {
//     console.error('❌ Script failed:', error.message);
//     process.exit(1);
//   }
// }

// // Run the migration
// migrateProperties();


require('dotenv').config();
const axios = require('axios');

// Zoho Configuration
const ZOHO_ACCESS_TOKEN = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_MODULE = process.env.ZOHO_MODULE || 'Leads';
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

// HubSpot Configuration
const HUBSPOT_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
const HUBSPOT_OBJECT_TYPE = process.env.HUBSPOT_OBJECT_TYPE || 'contacts';
const HUBSPOT_API = 'https://api.hubapi.com';

// Field type mapping from Zoho to HubSpot
const getHubSpotFieldType = (zohoFieldType) => {
  switch (zohoFieldType.toLowerCase()) {
    case 'picklist':
    case 'multiselectpicklist':
      return 'enumeration';
    case 'number':
    case 'decimal':
    case 'currency':
      return 'number';
    case 'datetime':
    case 'date':
      return 'datetime';
    case 'boolean':
      return 'bool';
    case 'phone':
    case 'email':
    case 'url':
      return 'string';
    default:
      return 'string';
  }
};

// Get custom properties from Zoho
async function getZohoCustomProperties() {
  const url = `${ZOHO_API_DOMAIN}/crm/v3/settings/fields?module=${ZOHO_MODULE}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Zoho-oauthtoken 1000.89311e29fd6fa863b8b8f29e201410a4.77c3c405ac0232ac4cd67ef3c780ec34`,
        'Content-Type': 'application/json'
      }
    });

    const zohoContactProperties = [
      "First Name", "Last Name", "Name Prefix", "Account Name", "Title",
      "Email", "Phone", "Mobile Phone", "Fax", "Twitter Username",
      "Mailing Street", "Mailing City", "Mailing Zip", "Mailing State",
      "Mailing Country", "Account", "Contact Owner"
    ];

    const allowedFieldLabels = [
      "Company",
      "First Page Visited",
      "First Visit",
      "Lead Owner",
      "Most Recent Visit",
      "No. of Employees",
      "Phone",
      "State",
      "Title"
    ];

    const allFields = response.data.fields || [];

    // Keep allowed fields and any other non-default fields
    const customFields = allFields.filter(
      field => allowedFieldLabels.includes(field.field_label) || !zohoContactProperties.includes(field.field_label)
    );

    console.log(`Found ${customFields.length} custom/allowed fields in Zoho ${ZOHO_MODULE} module.`);
    return customFields;
  } catch (error) {
    console.error('Error fetching Zoho properties:', error.response?.data || error.message);
    throw error;
  }
}

// Transform Zoho field to HubSpot property format
function transformZohoFieldToHubSpot(zohoField) {
  const hubspotFieldType = getHubSpotFieldType(zohoField.data_type);
  
  const hubspotProperty = {
    name: zohoField.api_name.toLowerCase().replace(/\s+/g, '_'), // lowercase with underscores
    label: zohoField.display_label || zohoField.field_label,
    type: hubspotFieldType,
    fieldType: hubspotFieldType === 'enumeration' ? 'select' : 'textarea',
    groupName: 'zohoinformation',
    description: zohoField.tooltip?.name || `Migrated from Zoho: ${zohoField.display_label}`,
  };

  if (hubspotFieldType === 'enumeration' && zohoField.pick_list_values) {
    hubspotProperty.options = zohoField.pick_list_values.map(option => ({
      label: option.display_value,
      value: option.actual_value,
      description: option.display_value,
      displayOrder: option.sequence_number || 0
    }));
  }

  if (zohoField.data_type.toLowerCase() === 'multiselectpicklist') {
    hubspotProperty.fieldType = 'checkbox';
  }

  return hubspotProperty;
}

// Create property in HubSpot
async function createHubSpotProperty(property) {
  const url = `${HUBSPOT_API}/crm/v3/properties/${HUBSPOT_OBJECT_TYPE}`;
  console.log("HUBSPOT_ACCESS_TOKEN",HUBSPOT_ACCESS_TOKEN)
  try {
    const response = await axios.post(url, property, {
      headers: {
        'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Created property: ${property.name} (${property.fieldType})`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 409) {
      console.log(`⚠️  Property already exists: ${property.name}`);
    } else {
      console.error(`❌ Failed to create property: ${property.name}`, error.response?.data?.message || error.message);
    }
  }
}

// Get existing HubSpot properties
async function getExistingHubSpotProperties() {
  const url = `${HUBSPOT_API}/crm/v3/properties/${HUBSPOT_OBJECT_TYPE}`;
  console.log("HUBSPOT_ACCESS_TOKEN",HUBSPOT_ACCESS_TOKEN)
  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`
      }
    });

    return response.data.results.map(prop => prop.name);
  } catch (error) {
    console.error('Error fetching existing HubSpot properties:', error.response?.data || error.message);
    return [];
  }
}

// Main migration function
async function migrateProperties() {
  try {
    console.log('🚀 Starting Zoho to HubSpot property migration...\n');

    const existingProperties = await getExistingHubSpotProperties();
    console.log(`Found ${existingProperties.length} existing properties in HubSpot.\n`);

    const zohoProperties = await getZohoCustomProperties();

    if (zohoProperties.length === 0) {
      console.log('No custom properties found in Zoho. Migration complete.');
      return;
    }

    console.log('\n🔄 Processing properties...\n');

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const zohoField of zohoProperties) {
      try {
        const hubspotProperty = transformZohoFieldToHubSpot(zohoField);

        if (existingProperties.includes(hubspotProperty.name)) {
          console.log(`⏭️  Skipping existing property: ${hubspotProperty.name}`);
          skipped++;
          continue;
        }

        await createHubSpotProperty(hubspotProperty);
        created++;

        await new Promise(resolve => setTimeout(resolve, 100)); // slight delay
      } catch (error) {
        failed++;
        console.error(`Error processing field: ${zohoField.api_name}`, error.message);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`✅ Created: ${created}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📝 Total processed: ${zohoProperties.length}`);
    console.log('\n🎉 Property migration complete!');
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

// Run the migration
migrateProperties();
