const axios = require("axios");
const fs = require("fs");

const ZOHO_ACCESS_TOKEN = "1000.e13fd4a63ed2fd440dcc2e7740eb6586.1184492758b9e914d38d4f599b54ab23";

async function fetchFields(moduleName) {
  try {
    const response = await axios.get(
      `https://www.zohoapis.com/crm/v2/settings/fields?module=${moduleName}`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${ZOHO_ACCESS_TOKEN}`,
        },
      }
    );

    return response.data.fields.map((field) => ({
      label: field.field_label,
      api_name: field.api_name,
      module: moduleName,
    }));
  } catch (error) {
    console.error(`❌ Error fetching fields for ${moduleName}:`, error?.response?.data || error.message);
    return [];
  }
}

async function fetchAndCompare() {
  const leadsFields = await fetchFields("Leads");
  const contactsFields = await fetchFields("Contacts");

  const leadsMap = new Map(leadsFields.map(f => [f.api_name, f]));
  const contactsMap = new Map(contactsFields.map(f => [f.api_name, f]));

  const commonFields = [];
  const uncommonFields = [];

  // Check in Leads
  for (const field of leadsFields) {
    if (contactsMap.has(field.api_name)) {
      commonFields.push({ ...field });
    } else {
      uncommonFields.push({ ...field });
    }
  }

  // Check in Contacts for fields not in Leads
  for (const field of contactsFields) {
    if (!leadsMap.has(field.api_name)) {
      uncommonFields.push({ ...field });
    }
  }

  fs.writeFileSync("common_fields.json", JSON.stringify(commonFields, null, 2));
  fs.writeFileSync("uncommon_fields.json", JSON.stringify(uncommonFields, null, 2));

  console.log("✅ Saved:");
  console.log("- common_fields.json");
  console.log("- uncommon_fields.json");
}

fetchAndCompare();
