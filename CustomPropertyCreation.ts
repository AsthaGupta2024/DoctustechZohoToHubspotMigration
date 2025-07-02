const axios = require("axios");

const HUBSPOT_ACCESS_TOKEN = "YOUR_HUBSPOT_ACCESS_TOKEN";
const OBJECT_TYPE = "contacts"; // or deals, companies, tickets, products

// Define all custom properties you want to create
const properties = [
  {
    name: "custom_field_1",
    label: "Custom Field 1",
    description: "This is custom field 1",
    groupName: "contactinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "custom_field_2",
    label: "Custom Field 2",
    description: "This is custom field 2",
    groupName: "contactinformation",
    type: "number",
    fieldType: "number",
    formField: true
  },
  {
    name: "custom_dropdown",
    label: "Custom Dropdown",
    description: "This is a dropdown field",
    groupName: "contactinformation",
    type: "enumeration",
    fieldType: "select",
    formField: true,
    options: [
      { label: "Option A", value: "option_a" },
      { label: "Option B", value: "option_b" },
      { label: "Option C", value: "option_c" }
    ]
  }
];

async function createProperties() {
  for (const property of properties) {
    try {
      const response = await axios.post(
        `https://api.hubapi.com/properties/v2/${OBJECT_TYPE}/properties`,
        property,
        {
          headers: {
            Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
      console.log(`✅ Created property: ${property.name}`);
    } catch (error) {
      console.error(
        `❌ Error creating property ${property.name}:`,
        error.response?.data || error.message
      );
    }
  }
}

createProperties();
