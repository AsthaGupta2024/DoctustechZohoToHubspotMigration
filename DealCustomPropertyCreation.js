require('dotenv').config();
const axios = require("axios");

const HUBSPOT_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
const OBJECT_TYPE = "deals";

const properties = [
  {
    name: "industry",  // Use your preferred internal name here
    label: "Industry",
    description: "Industry types synced from Zoho",
    groupName: "zohoinformation",  // Or "dealinformation" if it's for deals
    type: "enumeration",
    fieldType: "select",
    formField: true,
    options: [
      { label: "-None-", value: "-None-" },
      { label: "Insurance", value: "Insurance" },
      { label: "Health, Wellness & Fitness", value: "Health, Wellness & Fitness" },
      { label: "Medical Practice", value: "Medical Practice" },
      { label: "Hospital & Healthcare", value: "Hospital & Healthcare" },
      { label: "Hospitals & Physicians Clinics", value: "Hospitals & Physicians Clinics" }
    ]
  },
  {
    name: "lead_source",
    label: "Lead Source",
    description: "Lead source options migrated from Zoho",
    groupName: "zohoinformation",
    type: "enumeration",
    fieldType: "select",
    formField: true,
    options: [
      { label: "-None-", value: "-None-" },
      { label: "Campaign Email", value: "CAMPAIGN_EMAIL" },
      { label: "Awareness", value: "AWARENESS" },
      { label: "Casestudydoctustechhelpsboostrafaccuracy", value: "CASESTUDY" },
      { label: "Changes Between Hcc V24 And Hcc V28", value: "VERSION_CHANGES" },
      { label: "Chat", value: "CHAT" },
      { label: "Cleverly", value: "CLEVERLY" },
      { label: "Cold Call", value: "COLD_CALL" },
      { label: "Cold Linkedin Outreach", value: "LINKEDIN_OUTREACH" },
      { label: "Compliance Sme Interview", value: "COMPLIANCE_INTERVIEW" },
      { label: "Ebook Measuring The Value Of Value-Based Care", value: "EBOOK_VALUE_CARE" },
      { label: "Email", value: "EMAIL" },
      { label: "Expansion", value: "EXPANSION" },
      { label: "Facebook Ads", value: "FACEBOOK_ADS" },
      { label: "Growth", value: "Growth" },
      { label: "Hcc Quick Guide", value: "HCC_GUIDE" },
      { label: "Inbound", value: "INBOUND" },
      { label: "Integrated Platform Contact", value: "INTEGRATED_CONTACT" },
      { label: "Learn More - Performance Max Campaign", value: "PERFORMANCE_MAX" },
      { label: "Learn With App", value: "LEARN_APP" },
      { label: "Linkedin Form", value: "LINKEDIN_FORM" },
      { label: "Linkedin Sales Search", value: "LINKEDIN_SALES_SEARCH" },
      { label: "Linkedin SalesNav", value: "LINKEDIN_SALESNAV" },
      { label: "NOI Digital", value: "NOI_DIGITAL" },
      { label: "Ob Aco", value: "OB_ACO" },
      { label: "Ob Athena", value: "OB_ATHENA" },
      { label: "Ob Persona", value: "OB_PERSONA" },
      { label: "Ob Re-Engaged", value: "OB_RE-ENGAGED" },
      { label: "Oppt Drive", value: "OPPT_DRIVE" },
      { label: "Personal Network", value: "PERSONAL_NETWORK" },
      { label: "PPC", value: "PPC" },
      { label: "Radv Whitepaper", value: "RADV_WHITEPAPER" },
      { label: "Raf Revenue Calculator", value: "RAF_REVENUE_CALCULATOR" },
      { label: "Referral", value: "REFERRAL" },
      { label: "Risk Adjustment One Pager", value: "RISK_ADJUSTMENT_ONE_PAGER" },
      { label: "Schedule A Demo", value: "SCHEDULE1_A_DEMO" },
      { label: "Scupdap", value: "SCUPDAP" },
      { label: "Seamless", value: "SEAMLESS" },
      { label: "Site Contact Us", value: "SITE_CONTACT_US" },
      { label: "Visitor Insites", value: "VISITOR_INSITES" },
      { label: "Webinar", value: "WEBINAR" },
      { label: "Website", value: "WEBSITE" },
      { label: "Website Visit", value: "WEBSITE_VISIT" },
      { label: "YAMM", value: "YAMM" },
      { label: "Zoominfo Sales Search", value: "ZOOMINFO_SALES_SEARCH" }
    ]
  },
  {
    name: "zoho_deal_id",
    label: "Zoho Deal Id",
    description: "Zoho Deal Id",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "zoho_deal_owner_id",
    label: "Zoho Deal Owner Id",
    description: "Zoho Deal Owner Id",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "zoho_lead_email",
    label: "Zoho Lead Email",
    description: "Zoho Lead Email",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "phone",
    label: "Phone",
    description: "Phone",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "phone",
    formField: true
  },
   {
    name: "description",
    label: "Description",
    description: "Description",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "ownerid",
    label: "Owner ID",
    description: "Zoho Owner ID",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "campaign_source_id",
    label: "Campaign Source Id",
    description: "Campaign Source Id",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "campaign_source_name",
    label: "Campaign Source Name",
    description: "Campaign Source Name",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },

  {
    name: "ownername",
    label: "Owner Name",
    description: "Zoho Owner Name",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },

  {
    name: "ownername",
    label: "Owner Name",
    description: "Zoho Owner Name",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "owneremail",
    label: "Owner Email",
    description: "Zoho Owner Email",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "zoho_contact_id",
    label: "Zoho Contact ID",
    description: "Zoho Contact ID",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "zoho_bdr_id",
    label: "Zoho BDR ID",
    description: "Zoho BDR ID",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "zoho_lead_id",
    label: "Zoho Lead ID",
    description: "Zoho Lead ID",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "zoho_lead_email",
    label: "Zoho Lead Email",
    description: "Zoho Lead Email",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "zoho_lead_email",
    label: "Zoho Lead Email",
    description: "Zoho Lead Email",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "modified_by_id",
    label: "Modified By ID",
    description: "Zoho Modified By User ID",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "modified_by_name",
    label: "Modified By Name",
    description: "Zoho Modified By User Name",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "modified_by_email",
    label: "Modified By Email",
    description: "Zoho Modified By User Email",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "created_by_id",
    label: "Created By ID",
    description: "Zoho Created By User ID",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "created_by_name",
    label: "Created By Name",
    description: "Zoho Created By User Name",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "created_by_email",
    label: "Created By Email",
    description: "Zoho Created By User Email",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "account_name",
    label: "Account Name",
    description: "Name of associated account",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "account_id",
    label: "Account ID",
    description: "ID of associated account",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "contact_id",
    label: "Contact ID",
    description: "ID of associated contact",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "lead_owner_id",
    label: "Lead Owner ID",
    description: "ID of the lead owner",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "title",
    label: "Title",
    description: "Job title or designation",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  },
  {
    name: "email",
    label: "Email",
    description: "Email address of the lead",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text",
    formField: true
  }
];

// 👇 Helper to fetch all existing properties from HubSpot
async function getExistingPropertyNames() {
  console.log("HUBSPOT_ACCESS_TOKEN:", HUBSPOT_ACCESS_TOKEN);
  try {
    const response = await axios.get(
      `https://api.hubapi.com/properties/v2/${OBJECT_TYPE}/properties`,
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data.map(prop => prop.name); // array of existing property names
  } catch (error) {
    console.error("❌ Error fetching existing properties:", error.response?.data || error.message);
    return [];
  }
}

async function createProperties() {
  const existingPropertyNames = await getExistingPropertyNames();

  for (const property of properties) {
    if (existingPropertyNames.includes(property.name)) {
      console.log(`⏭️ Skipped existing property: ${property.name}`);
      continue;
    }
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
