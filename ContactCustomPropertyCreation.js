require('dotenv').config();
const axios = require("axios");

const HUBSPOT_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
const OBJECT_TYPE = "contacts"; // Can be 'contacts', 'deals', etc.

const properties = [
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
      { label: "App Free Trial", value: "APP_FREE_TRIAL" },
      { label: "Awareness", value: "AWARENESS" },
      { label: "Casestudydoctustechhelpsboostrafaccuracy", value: "CASESTUDY" },
      { label: "Changes Between Hcc V24 And Hcc V28", value: "VERSION_CHANGES" },
      { label: "Cold Call", value: "COLD_CALL" },
      { label: "Cold Linkedin Outreach", value: "LINKEDIN_OUTREACH" },
      { label: "Compliance Sme Interview", value: "COMPLIANCE_INTERVIEW" },
      { label: "Demo Account User", value: "DEMO_USER" },
      { label: "Discovery", value: "DISCOVERY" },
      { label: "Ebook Measuring The Value Of Value-Based Care", value: "EBOOK_VALUE_CARE" },
      { label: "Email", value: "EMAIL" },
      { label: "Existing Customer", value: "EXISTING_CUSTOMER" },
      { label: "Facebook Ads", value: "FACEBOOK_ADS" },
      { label: "Growth", value: "Growth" },
      { label: "Hcc Audits Compliance", value: "HCC_COMPLIANCE" },
      { label: "Hcc Quick Guide", value: "HCC_GUIDE" },
      { label: "Integrated Platform Contact", value: "INTEGRATED_CONTACT" },
      { label: "Lead Gen Form", value: "LEAD_GEN_FORM" },
      { label: "Learn About App", value: "LEARN_ABOUT_APP" },
      { label: "Learn More - Performance Max Campaign", value: "PERFORMANCE_MAX" },
      { label: "Learn With App", value: "LEARN_APP" },
      { label: "Learn With Doctus", value: "LEARN_DOCTUS" },
      { label: "Learn With Doctustech", value: "LEARN_DOCTUSTECH" },
      { label: "Learn With Mobile App", value: "LEARN_MOBILE_APP" },
      { label: "Linkedin Ads", value: "LINKEDIN_ADS" },
      { label: "Linkedin Form", value: "LINKEDIN_FORM" },
      { label: "Linkedin Sales Search", value: "LINKEDIN_SALES_SEARCH" },
      { label: "Ob Aco", value: "OB_ACO" },
      { label: "Ob Athena", value: "OB_ATHENA" },
      { label: "Ob Persona", value: "OB_PERSONA" },
      { label: "Ob Re-Engaged", value: "OB_RE-ENGAGED" },
      { label: "Personal Network", value: "PERSONAL_NETWORK" },
      { label: "Radv Whitepaper", value: "RADV_WHITEPAPER" },
      { label: "Raf Revenue Calculator", value: "RAF_REVENUE_CALCULATOR" },
      { label: "Referral", value: "REFERRAL" },
      { label: "Risk Adjustment One Pager", value: "RISK_ADJUSTMENT_ONE_PAGER" },
      { label: "Roi Calculator", value: "ROI_Calculator" },
      { label: "Schedule A Demo", value: "SCHEDULE1_A_DEMO" },
      { label: "Scupdap", value: "SCUPDAP" },
      { label: "Seamless", value: "SEAMLESS" },
      { label: "Site Contact Us", value: "SITE_CONTACT_US" },
      { label: "Tradeshow", value: "TRADESHOW" },
      { label: "Visitor Insites", value: "VISITOR_INSITES" },
      { label: "Webinar", value: "WEBINAR" },
      { label: "Zoominfo", value: "ZOOMINFO" }
    ]
  },
  {
    name: "object_status",
    label: "Object Status",
    description: "Status field for object",
    groupName: "zohoinformation",
    type: "enumeration",
    fieldType: "select",
    formField: true,
    options: [
      {
        label: "Contact",
        value: "Contact",
        description: "Contact",
        displayOrder: 1
      },
      {
        label: "Lead",
        value: "Lead",
        description: "Lead",
        displayOrder: 2
      },
      {
        label: "Zoho Desk Contact",
        value: "Zoho Desk Contact",
        description: "Zoho Desk Contact",
        displayOrder: 3
      }
    ]
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
    name: "lead_contact_status",
    label: "Lead Contact Status",
    description: "Zoho Lead Contact Status mapped to HubSpot",
    groupName: "zohoinformation",
    type: "enumeration",
    fieldType: "select",
    formField: true,
    options: [
      { label: "-None-", value: "NONE", displayOrder: 1 },
      { label: "Qualified", value: "QUALIFIED", displayOrder: 2 },
      { label: "Is Not Qualified", value: "IS_NOT_QUALIFIED", displayOrder: 3 },
      { label: "SQL Qualified", value: "SQL_QUALIFIED", displayOrder: 4 },
      { label: "Not Qualified", value: "NOT_QUALIFIED", displayOrder: 5 },
      { label: "Unknown", value: "UNKNOWN", displayOrder: 6 },
      { label: "Prospect", value: "PROSPECT", displayOrder: 7 },
      { label: "Do Not Call", value: "DO_NOT_CALL", displayOrder: 8 },
      { label: "Do Not Contact", value: "DO_NOT_CONTACT", displayOrder: 9 },
      { label: "Customer", value: "CUSTOMER", displayOrder: 10 },
      { label: "Pre-Qualified", value: "PRE_QUALIFIED", displayOrder: 11 },
      { label: "Contacted", value: "CONTACTED", displayOrder: 12 },
      { label: "Contact in Future", value: "CONTACT_IN_FUTURE", displayOrder: 13 },
      { label: "Not Contacted", value: "NOT_CONTACTED", displayOrder: 14 },
      { label: "Attempted to Contact", value: "ATTEMPTED_TO_CONTACT", displayOrder: 15 },
      { label: "Lost Lead", value: "LOST_LEAD", displayOrder: 16 },
      { label: "Meeting - Pending", value: "MEETING_PENDING", displayOrder: 17 },
      { label: "Nurture", value: "NURTURE", displayOrder: 18 },
      { label: "Meeting - Booked", value: "MEETING_BOOKED", displayOrder: 19 },
      { label: "Channel Partner", value: "CHANNEL_PARTNER", displayOrder: 20 },
      { label: "Imported", value: "IMPORTED", displayOrder: 21 },
      { label: "PPC - New", value: "PPC_NEW", displayOrder: 22 },
      { label: "Warm", value: "WARM", displayOrder: 23 },
      { label: "Call me", value: "CALL_ME", displayOrder: 24 },
      { label: "Inactive", value: "INACTIVE", displayOrder: 25 },
      { label: "Email 4", value: "EMAIL_4", displayOrder: 26 },
      { label: "Called", value: "CALLED", displayOrder: 27 },
      { label: "No Phone Number", value: "NO_PHONE_NUMBER", displayOrder: 28 },
      { label: "Left Voicemail", value: "LEFT_VOICEMAIL", displayOrder: 29 },
      { label: "New Lead", value: "NEW", displayOrder: 30 },
      { label: "Open", value: "OPEN", displayOrder: 31 },
      { label: "In Progress", value: "IN_PROGRESS", displayOrder: 32 },
      { label: "Open Deal", value: "OPEN_DEAL", displayOrder: 33 },
      { label: "Unqualified", value: "UNQUALIFIED", displayOrder: 34 },
      { label: "Connected", value: "CONNECTED", displayOrder: 35 },
      { label: "Bad Timing", value: "BAD_TIMING", displayOrder: 36 }
    ]
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
    name: "created_time_utc",
    label: "Created Time UTC",
    description: "UTC timestamp of record creation",
    groupName: "zohoinformation",
    type: "datetime",
    fieldType: "date"
  },
  {
    name: "modified_time_utc",
    label: "Modified Time UTC",
    description: "UTC timestamp of last modification",
    groupName: "zohoinformation",
    type: "datetime",
    fieldType: "date"
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
    name: "reporting_to_name",
    label: "Reporting To Name",
    description: "Name of the reporting manager",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "reporting_to_id",
    label: "Reporting To ID",
    description: "ID of the reporting manager",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "zoho_lead_name",
    label: "Zoho Lead Name",
    description: "Lead Name from Zoho",
    groupName: "zohoinformation",
    type: "string",
    fieldType: "text"
  },
  {
    name: "time_zone",
    label: "Time zone",
    description: "Time zone of the user",
    groupName: "zohoinformation",
    type: "enumeration",
    fieldType: "select",
    formField: true,
    options: [
      {
        label: "-None-",
        value: "-None-",
        description: "-None-",
        displayOrder: 1
      },
      {
        label: "Pacific",
        value: "Pacific",
        description: "Pacific",
        displayOrder: 2
      },
      {
        label: "Mountain",
        value: "Mountain",
        description: "Mountain",
        displayOrder: 3
      },
      {
        label: "Central",
        value: "Central",
        description: "Central",
        displayOrder: 4

      },
      {
        label: "Eastern",
        value: "Eastern",
        description: "Eastern",
        displayOrder: 5
      }
    ]
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
