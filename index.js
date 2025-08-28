const express = require("express");
const axios = require("axios");
const app = express();
const qs = require("qs");
const hsHelpers = require("./hshelpers.js");
const activities = require("./Activities.js");
require("dotenv").config();

let currentAccessToken = null;
let refreshToken = null;
let refreshTimeout = null;
let tokenExpiryTime = null;

const BASE_URI = process.env.BASE_URI;
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const logger = require("./src/utils/logger.js");

const DESTINATION_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
const CONTACT_ERROR_LOG_FILE = path.join(__dirname, "contact-sync-errors.json");
const EMAILS_LOG_FILE = path.join(__dirname, "zoho-emails.json");
const NOTES_LOG_FILE = "zoho_contact_notes_log.json";
const TICKET_LOG_FILE = "zoho_ticket_log.json";
let currentZohoAccessToken = null;

const HUBSPOT_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
function normalizeLabel(label) {
  return label
    .toLowerCase()
    .replace(/\s+/g, "_") // spaces → underscores
    .replace(/[^\w]/g, ""); // remove special characters (optional)
}
// 🎯 Hardcoded fallback mappings for unmatched normalized labels
const hardcodedFieldOverrides = {
  company: "company",
  title: "title",
  //comment phone for deals
  // phone: "phone",
  website: "website",
  employees: "employees",
  no_of_employee: "no_of_employee",
  state: "state",
  notes_: "notes",
  organization_type: "industry",
  currentCompanyUrl: "currentcompanyurl",
  ads_platform: "ad_source",
  phone__company_hq: "phone_2",
  first_visit: "first_visited_time",
  most_recent_visit: "last_visited_time",
  first_page_visited: "first_visited_url",
  linkedin_connection: "linkedin_connected",
  suffix: "salutation",
  bdr_owner: "zoho_bdr_id",
  lead_owner: "lead_owner",
  email: "email",
  account_name: "account_name",
  fax: "fax",
  // lead_contact_status:"lead_contact_status"
};
async function getZohoAccessToken() {
  const response = await axios.post(
    "https://accounts.zoho.com/oauth/v2/token",
    null,
    {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: "refresh_token",
      },
    }
  );
  return response.data.access_token;
}

async function getValidZohoAccessToken(forceRefresh = false) {
  if (!currentZohoAccessToken || forceRefresh) {
    currentZohoAccessToken = await getZohoAccessToken();
  }
  return currentZohoAccessToken;
}

async function zohoApiRequest(config) {
  let token = await getValidZohoAccessToken();
  config.headers = config.headers || {};
  config.headers["Authorization"] = `Zoho-oauthtoken ${token}`;
  try {
    return await axios(config);
  } catch (error) {
    if (error.response && error.response.status === 401) {
      token = await getValidZohoAccessToken(true);
      config.headers["Authorization"] = `Zoho-oauthtoken ${token}`;
      return await axios(config);
    }
    throw error;
  }
}
async function refreshAccessToken() {
  const url = "https://accounts.zoho.com/oauth/v2/token"; // make sure this matches with the token creation domain
  if (!refreshToken) {
    throw new Error("❌ Missing refresh token. Cannot refresh access token.");
  }

  const data = qs.stringify({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const { access_token, expires_in } = response.data;

    // 🟢 Save updated access token globally
    currentAccessToken = access_token;
    tokenExpiryTime = Date.now() + (expires_in - 60) * 1000;

    console.log(
      "✅ Refreshed Zoho access_token. Expires in:",
      expires_in,
      "seconds"
    );

    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(refreshAccessToken, (expires_in - 60) * 1000);

    return access_token;
  } catch (error) {
    console.error(
      "❌ Error auto-refreshing access token:",
      error.response?.data || error.message
    );
    throw new Error("Access token refresh failed."); // Do not return null
  }
}

// 1. Fetch Zoho field map
async function fetchZohoFieldMap(objectName) {
  const url = `https://www.zohoapis.com/crm/v3/settings/fields?module=${objectName}`;
  const map = {};

  const res = await zohoApiRequest({
    method: "get",
    url: `${url}`,
  });
  const fieldCount = res.data.fields.length;
  logger.info(`📦 Total fields in Zoho ${objectName} module: ${fieldCount}`);

  res.data.fields.forEach((f) => {
    const normalized = normalizeLabel(f.field_label);
    map[normalized] = f.api_name;
  });

  return map;
}

// 2. Fetch HubSpot field map
async function fetchHubSpotFieldMap(objecttype) {
  const url = `https://api.hubapi.com/crm/v3/properties/${objecttype}`;
  const map = {};
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    },
  });

  res.data.results.forEach((f) => {
    const normalized = normalizeLabel(f.label);

    // ❌ Skip hs_lead_status to avoid accidental mapping
    if (f.name === "hubspot_owner_id") {
      logger.info(`🚫 Skipping default HubSpot property: hs_lead_status`);
      return;
    }
    if (f.name === "stage") {
      logger.info(`🚫 Skipping default HubSpot property: hs_lead_status`);
      return;
    }
    if (f.name === "Created_Time") {
      logger.info(`🚫 Skipping default HubSpot property: Created_Time`);
      return;
    }
    if (f.name === "Modified_Time") {
      logger.info(`🚫 Skipping default HubSpot property: Modified_Time`);
      return;
    }
    // comment for deals
    // if (f.name === "lead_source_type") {
    //   logger.info(`🚫 Skipping default HubSpot property: lead_source_type`);
    //   return;
    // }
    // if (f.name === "lead_contact_status") {
    //   logger.info(`🚫 Skipping default HubSpot property: lead_contact_status`);
    //   return;
    // }
    if (f.name === "bdr_owner") {
      logger.info(`🚫 Skipping default HubSpot property: lead_contact_status`);
      return;
    }
    //uncomment for contact and deal
    if (f.name === "hs_lead_status") {
      logger.info(`🚫 Skipping default HubSpot property: lead_contact_status`);
      return;
    }

    map[normalized] = f.name;
  });
  // console.log("🔗 Hubspot Field Map:", map);

  return map;
}

// 3. Build dynamic map: Zoho API name ➜ HubSpot API name
async function buildFieldMap() {
  // const zohoFields = await fetchZohoFieldMap("Leads"); // { normalized_label: zohoApiName }
  // const hubspotFields = await fetchHubSpotFieldMap("contacts"); // { normalized_label: hubspotApiName }

  // const zohoFields = await fetchZohoFieldMap("Deals"); // { normalized_label: zohoApiName }
  // const hubspotFields = await fetchHubSpotFieldMap("deals"); // { normalized_label: hubspotApiName }

  const zohoFields = await fetchZohoFieldMap("Contacts"); // { normalized_label: zohoApiName }
  const hubspotFields = await fetchHubSpotFieldMap("contacts"); // { normalized_label: hubspotApiName }

  const dynamicMap = {};
  const unmatchedFields = [];

  for (const [normalizedLabel, zohoApiName] of Object.entries(zohoFields)) {
    if (hubspotFields[normalizedLabel]) {
      dynamicMap[zohoApiName] = hubspotFields[normalizedLabel];
    } else if (hardcodedFieldOverrides[normalizedLabel]) {
      dynamicMap[zohoApiName] = hardcodedFieldOverrides[normalizedLabel];
    } else {
      unmatchedFields.push({ label: normalizedLabel, apiName: zohoApiName });
    }
  }

  if (unmatchedFields.length > 0) {
    logger.info("\n⚠️ Unmatched Zoho Fields (not found in HubSpot):");
    unmatchedFields.forEach((field) => {
      logger.info(`❌ ${field.apiName} (label: ${field.label})`);
    });
  }

  return dynamicMap;
}

app.get("/zoho/contacts", async (req, res) => {
  const objectType = "Contact";
  let page = 1;
  let moreRecords = true;

  try {
    logger.info('Start COntact migration.........');
    logger.info('building mapp....');
    const fieldMap = await buildFieldMap();

    while (moreRecords) {
      console.log(`📄 Fetching page: ${page}`);

      const url = `https://www.zohoapis.com/crm/v2/Contacts?per_page=5&page=${page}`;
      // const url = "https://www.zohoapis.com/crm/v2/Contacts/4582160000102983007";

       const contactRes = await zohoApiRequest({
        method: "get",
        url: `${url}`,
      });

      const zohoContacts = contactRes.data.data || [];
      logger.info(
        `📦 Fetched ${zohoContacts.length} Zoho contacts on page ${page}`
      );

      if (zohoContacts.length === 0) {
        moreRecords = false;
        break;
      }

      await syncContactsToHubSpot(zohoContacts, fieldMap, objectType);

      moreRecords = contactRes.data.info?.more_records || false;
      page += 1;
    }

    res.status(200).json({ message: "✅ Zoho contacts synced to HubSpot." });
  } catch (error) {
    const errData = error.response?.data;

    if (errData?.code === "INVALID_TOKEN") {
      console.warn("⚠️ Access token invalid. Refreshing...");
      access_token = await refreshAccessToken(); // You must implement this if not already
      return res
        .status(401)
        .json({ message: "Token refreshed. Please retry." });
    }

    if (
      errData?.code === "RATE_LIMIT_EXCEEDED" ||
      errData?.message?.toLowerCase().includes("rate limit") ||
      errData?.code === "TOO_MANY_REQUESTS"
    ) {
      console.error(`⏳ Rate limit hit. Stopping sync.`);
      return res
        .status(429)
        .json({ error: "Rate limit hit. Try again later." });
    }

    console.error("❌ Unhandled error during sync:", errData || error.message);
    res.status(500).json({
      error: "Failed to sync contacts.",
      details: errData || error.message,
    });
  }
});

async function syncContactsToHubSpot(zohoContacts, fieldMap, objectType) {
  const emailStatusMap = {
    "-None-": "NONE",
    "Request is in progress": "Request is in progress",
    Real: "Existing",
    Fake: "Nonexistent",
    Unknown: "Unknown",
    "Out of limit": "Out of limit",
    "Safe to send": "Safe to send",
  };
  const leadStageMap = {
    "-none-": "-None-",
    "intro meeting": "Option 2", // 👈 correct internal value
    "discovery meeting": "Value Proposition (40%)",
    qualified: "Option 1",
    proposal: "Proposal",
    contracting: "Contracting",
    unqualified: "Unqualified",
    nurture: "Nurture",
    "closed lost (0%)": "Closed Lost (0%)",
    "proposal/quote sent (75%)": "Proposal/Quote Sent (75%)",
    "closed won (100%)": "Closed Won (100%)",
    "identify decision makers (60%)": "Identify Decision Makers (60%)",
    "negotiation/review (90%)": "Negotiation/Review (90%)",
  };
  const leadStatusMap = {
    "-None-": "NONE",
    Qualified: "QUALIFIED",
    "Is Not Qualified": "IS_NOT_QUALIFIED",
    "SQL Qualified": "SQL_QUALIFIED",
    "Not Qualified": "NOT_QUALIFIED",
    Unknown: "UNKNOWN",
    Prospect: "PROSPECT",
    "Do Not Call": "DO_NOT_CALL",
    "Do Not Contact": "DO_NOT_CONTACT",
    Customer: "CUSTOMER",
    "Pre-Qualified": "PRE_QUALIFIED",
    Contacted: "CONTACTED",
    "Contact in Future": "CONTACT_IN_FUTURE",
    "Not Contacted": "NOT_CONTACTED",
    "Attempted to Contact": "ATTEMPTED_TO_CONTACT",
    "Lost Lead": "LOST_LEAD",
    "Meeting - Pending": "MEETING_PENDING",
    Nurture: "NURTURE",
    "Meeting - Booked": "MEETING_BOOKED",
    "Channel Partner": "CHANNEL_PARTNER",
    Imported: "IMPORTED",
    "PPC - New": "PPC_NEW",
    Warm: "WARM",
    "Call me": "CALL_ME",
    Inactive: "INACTIVE",
    "Email 4": "EMAIL_4",
    Called: "CALLED",
    "No Phone Number": "NO_PHONE_NUMBER",
    "Left Voicemail": "LEFT_VOICEMAIL",
    "New Lead": "NEW",
    Open: "OPEN",
    "In Progress": "IN_PROGRESS",
    "Open Deal": "OPEN_DEAL",
    Unqualified: "UNQUALIFIED",
    Connected: "CONNECTED",
    "Bad Timing": "BAD_TIMING",
  };
  const leadTypeMap = {
    critical: "Critical",
    hot: "Hot",
    warm: "Warm",
    cold: "Cold",
    "-none-": "-None-",
  };
  const leadSourceMap = {
        "-None-": "-None-",
        "Campaign Email": "Campaign Email", 
        "CasestudyDoctusTechHelpsboostRAFaccuracy": "CASESTUDY",
        "Changes between HCC V24 and HCC V28": "VERSION_CHANGES", 
        "Chat": "Chat", 
        "Cleverly": "Cleverly", 
        "Cold Call": "COLD_CALL",
        "Cold LinkedIn Outreach": "LINKEDIN_OUTREACH", 
        "Compliance SME interview": "COMPLIANCE_INTERVIEW",
        "Demo Account User": "DEMO_USER",
        "Ebook Measuring the value of value-based care": "EBOOK_VALUE_CARE",
        "Facebook Ads": "FACEBOOK_ADS",
        "Google AdWords": "Google AdWords", 
        "Growth": "Growth",
        "HCC Audits Compliance": "HCC Audits Compliance", 
        "HCC QUICK GUIDE": "HCC_GUIDE",
        "Inbound": "Inbound", 
        "INTEGRATED PLATFORM CONTACT": "INTEGRATED_CONTACT",
        "Internal Seminar": "Internal Seminar", 
        "Learn More - Performance Max Campaign": "PERFORMANCE_MAX",
        "LEARN WITH APP": "LEARN_APP",
        "LINKEDIN FORM": "LINKEDIN_FORM",
        "LinkedIn Sales Search": "LINKEDIN_SALES_SEARCH",
        "LinkedIn SalesNav": "LinkedIn SalesNav", 
        "NOI Digitial": "NOI Digitial", 
        "OB ACO": "OB_ACO",
        "OB Athena": "OB_ATHENA",
        "OB Persona": "OB_PERSONA",
        "OB Re-Engaged": "OB_RE-ENGAGED",
        "Oppt Drive": "Oppt Drive", 
        "Personal Network": "PERSONAL_NETWORK",
        "Prior Connection": "Prior Connection", 
        "RADV WHITEPAPER": "RADV_WHITEPAPER",
        "RAF revenue calculator": "RAF_REVENUE_CALCULATOR",
        "Referral": "REFERRAL",
        "Risk adjustment one pager": "RISK_ADJUSTMENT_ONE_PAGER",
        "SCHEDULE A DEMO": "SCHEDULE1_A_DEMO",
        "SCU PDAP": "SCU PDAP", 
        "Seamless": "Seamless",
        "SITE CONTACT US": "SITE_CONTACT_US",
        "Trade Show": "Trade Show", 
        "Twitter": "Twitter", 
        "Visitor InSites": "VISITOR_INSITES",
        "Web Research": "Web Research", 
        "Webinar": "WEBINAR",
        "Website Landing Form": "Website Landing Form", 
        "Website Visit": "Website Visit", 
        "YAMM": "YAMM", 
        "ZoomInfo": "ZoomInfo",
        "ZoomInfo Sales Search": "ZoomInfo Sales Search"
    };
  const leadSourceTypeMap = {
    "-none-": "-None-",
    "demo account": "Demo Account",
    expansion: "Expansion",
    growth: "Growth",
    "inside sales": "Inside Sales",
    organic: "Organic",
    ppc: "PPC",
    relationship: "Relationship",
  };
  const meetingScheduledMap = {
    yes: "Option 1",
    no: "Option 2",
    pending: "Pending",
    "-none-": "-None-",
  };

  for (const contact of zohoContacts) {
    let payload = {};
    try {
      if (!contact.Email) continue;
      const existingId = await hsHelpers.searchContactInHubSpot(contact.Email);
      logger.info(
        `🔍 Searching for existing contact with email: ${contact.Email}`
      );
      const properties = {};
      for (const [zohoKey, hubspotKeyOriginal] of Object.entries(fieldMap)) {
        if (hubspotKeyOriginal === "lead_stage") {
          logger.info(`⏭️ Skipping lead_stage for ${contact.Email}`);
          continue;
        }
        let hubspotKey = hubspotKeyOriginal;
        let value;

        if (zohoKey === "BDR_Owner") {
          value = contact.BDR_Owner?.name || null;
        } else {
          value = contact[zohoKey];
        }

        if (
          (value !== null &&
            value !== undefined &&
            (typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean")) ||
          Array.isArray(value)
        ) {
          // 🛠 Mapping rules
          if (hubspotKey === "zohocheckeremail__email_status") {
            if (emailStatusMap[value]) {
              properties[hubspotKey] = emailStatusMap[value];
            } else {
              logger.warn(
                `⚠️ Skipping invalid email status value "${value}" for ${contact.Email}`
              );
            }
          } else if (
            hubspotKey === "zohocheckeremail__secondary_email_status"
          ) {
            if (emailStatusMap[value]) {
              properties[hubspotKey] = emailStatusMap[value];
            } else {
              logger.warn(
                `⚠️ Skipping invalid email status value "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_type") {
            const mappedType = leadTypeMap[String(value).toLowerCase()];
            if (mappedType) {
              properties[hubspotKey] = mappedType;
            } else {
              logger.warn(
                `⚠️ Skipping invalid lead type "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_source_type") {
            const leadSourceType = contact.Lead_Source_Type;
            const mappedStatus =
              leadSourceTypeMap[leadSourceType.toLowerCase()];
            if (mappedStatus) {
              properties[hubspotKey] = mappedStatus;
              logger.info(
                `📧 Mapped lead_source_type (custom): ${mappedStatus}`
              );
            } else {
              logger.warn(
                `⚠️ Skipping invalid lead_source_type "${leadSourceType}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "meeting_type") {
            const meetingTypes = contact.Meeting_Type;

            if (!Array.isArray(meetingTypes) || meetingTypes.length === 0) {
              logger.warn(
                `⚠️ No valid meeting_type found for ${contact.Email}`
              );
            } else {
              properties[hubspotKey] = meetingTypes.join(";");
              logger.info(`🟡 Mapped meeting_type: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "program") {
            const program = contact.Program;
            logger.info("🟡 Raw Program from Zoho:", program);

            if (!Array.isArray(program) || program.length === 0) {
              logger.warn(`⚠️ No valid program found for ${contact.Email}`);
            } else {
              properties[hubspotKey] = program.join(";");
              logger.info(`🟡 Mapped program: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "linkedin_connected") {
            const linkedinConnected = contact.LinkedIn_Connected;
            logger.info(
              "🟡 Raw linkedinConnected from Zoho:",
              linkedinConnected
            );

            if (
              !Array.isArray(linkedinConnected) ||
              linkedinConnected.length === 0
            ) {
              logger.warn(
                `⚠️ No valid linkedinConnected found for ${contact.Email}`
              );
            } else {
              properties[hubspotKey] = linkedinConnected.join(";");
              logger.info(
                `🟡 Mapped linkedinConnected: ${properties[hubspotKey]}`
              );
            }
          } else if (hubspotKey === "tag") {
            const tag = contact.Tag;
            logger.info("🟡 Raw tag from Zoho:", tag);

            if (!Array.isArray(tag) || tag.length === 0) {
              logger.warn(
                `⚠️ No valid linkedinConnected found for ${contact.Email}`
              );
              properties[hubspotKey] = ""; // ✅ Send empty string if no tags
            } else {
              properties[hubspotKey] = tag.join(";");
              logger.info(`🟡 Mapped tag: ${properties[hubspotKey]}`);
            }
          } else {
            properties[hubspotKey] = value;
          }
        }
      }
      // Add Zoho Lead ID manually
      properties["zoho_lead_id"] = contact.id;
      properties["ownerid"] = contact.Owner?.id;
      const bdrId = contact.BDR_Owner?.id || "DEFAULT_BDR_ID";
      properties["zoho_bdr_id"] = bdrId;
      const modifiedBy = contact.Modified_By?.id;
      properties["modified_by_id"] = modifiedBy;
      const modifiedByName = contact.Modified_By?.name;
      properties["modified_by_name"] = modifiedByName;
      const modifiedByEmail = contact.Modified_By?.email;
      properties["modified_by_email"] = modifiedByEmail;
      const createdBy = contact.Created_By?.id;
      properties["created_by_id"] = createdBy;
      const createdByName = contact.Created_By?.name;
      properties["created_by_name"] = createdByName;
      const createdByEmail = contact.Created_By?.email;
      properties["created_by_email"] = createdByEmail;
      // properties["hubspot_owner_id"] = contact.Owner?.id;
      properties["zoho_lead_name"] = contact.Owner?.name;
      properties["zoho_lead_email"] = contact.Owner?.email;
      properties["account_id"] = contact.Account_Name?.id;
      properties["account_name"] = contact.Account_Name?.name;
      properties["reporting_to_name"] = contact.Reporting_To?.name;
      properties["reporting_to_id"] = contact.Reporting_To?.id;
      properties["created_time"] = convertToUtcMillis(contact.Created_Time);
      properties["modified_time"] = convertToUtcMillis(contact.Modified_Time);
      properties["last_activity_time"] = convertToUtcMillis(
        contact.Last_Activity_Time
      );
      properties["object_status"] = objectType;
      properties["title"] = contact.Title;
      const zohoStatus = contact.Lead_Status;
      const mappedStatus = leadStatusMap[zohoStatus];
      if (mappedStatus) {
        properties["lead_contact_status"] = mappedStatus;
      } else {
        logger.warn(
          `⚠️ Skipping invalid lead_contact_status "${zohoStatus}" for ${contact.Email}`
        );
        // properties["lead_contact_status"] = 'NONE';
      }

      const zohoMeetingScheduled = contact.Meeting_scheduled;
      if (zohoMeetingScheduled) {
        const normalized = String(zohoMeetingScheduled).trim().toLowerCase();
        const mapped = meetingScheduledMap[normalized];
        if (mapped) {
          properties["meeting_scheduled"] = mapped;
        } else {
          logger.warn(
            `⚠️ Invalid meeting_scheduled "${zohoMeetingScheduled}" for ${contact.Email}`
          );
          // properties["meeting_scheduled"] = '-None-';

        }
      }

      const zohoLeadSource = contact.Lead_Source;
      const mappedLeadSource =
        leadSourceMap[String(zohoLeadSource).toLowerCase()];
      if (mappedLeadSource) {
        properties["lead_source"] = mappedLeadSource;
      } else {
        logger.warn(
          `⚠️ Skipping invalid lead_contact_status "${zohoLeadSource}" for ${contact.Email}`
        );
        // properties["lead_source"] = '-None-';
      }
      const leadSourceType = contact.Lead_Source_Type;
      const mappedSourceType =
        leadSourceTypeMap[String(leadSourceType).toLowerCase()];
      if (mappedSourceType) {
        properties["lead_source_type"] = mappedSourceType;
      } else {
        logger.warn(
          `⚠️ Skipping invalid lead_source_type "${leadSourceType}" for ${contact.Email}`
        );
        // properties["lead_source_type"] = '-None-';

      }
      const zohoLeadStage = contact.Lead_Stage;
      const normalizedLeadStage = String(zohoLeadStage)
        .trim()
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const mappedLeadStage = leadStageMap[normalizedLeadStage];
      if (mappedLeadStage) {
        properties["lead_stage"] = mappedLeadStage;
      } else {
        logger.warn(
          `⚠️ Skipping invalid lead_stage "${zohoLeadStage}" for ${contact.Email}`
        );
        properties["lead_stage"] = '-None-';
      }
      // Send to HubSpot
      payload = { properties };
      logger.info(
        `📩 Sending contact ${contact.Email} to HubSpot with payload`);
      if (existingId) {
        await axios.patch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );

        logger.info(`✅ Updated contact ${contact.Email}`);
      } else {
        const response = await axios.post(
          `https://api.hubapi.com/crm/v3/objects/contacts`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        logger.info(`✅ Created contact ${contact.Email}`);
      }
    } catch (err) {
      let errorMessage;
      if (err.response && err.response.data) {
        errorMessage = JSON.stringify(err.response.data, null, 2);
      } else {
        errorMessage = err.message;
      }
      logger.error(`❌ Error syncing ${contact.Email}`, errorMessage, payload, 'contact');
    }
  }
}

// Lead stage mapping
const leadStatusMap = {
  Prospect: "new-stage-id",
  Outreach: "attempting-stage-id",
  SQL: "connected-stage-id",
  // SQL: "qualified-stage-id",
  Nurture: "1841452734",
  "Not Moving Forward": "unqualified-stage-id",
};

// Function to map Zoho lead status
function mapLeadStage(zohoStatus) {
  if (!zohoStatus) return null;
  const status = zohoStatus.trim().toLowerCase();

  if (status == "junk lead") return "Prospect";

  /**
   * -None-
    Attempted to Contact
    Call me
    Called
    Channel Partner
    Contacted
    Customer
    Email 4
    Imported
    Meeting - Booked
    Meeting - Pending
    Not Contacted
    PPC - New
   */

  const outreach = [
    "-None-", "Attempted to Contact", "Call me", "Called",
    "Channel Partner", "Contacted", "Customer", "Email 4",
    "Imported", "Meeting - Booked", "Meeting - Pending",
    "Not Contacted", "PPC - New"  ];

  if (outreach.some(e => e.toLowerCase() === status.toLowerCase())) {
    return "Outreach";
  }


/**
 * Qualified
  SQL Qualified
 */
  const sql = ["Qualified", "SQL Qualified"];
  if (sql.some(e => e.toLowerCase() === status.toLowerCase())) {
    return "SQL";
  }


  /**
   * Do Not Call
    Lost Lead
    No Phone Number
    Not Qualified
   */
  const notMoving = [
    "Do Not Call", "Lost Lead", "No Phone Number",
    "Not Qualified" ];
  
    if (notMoving.some(e => e.toLowerCase() === status.toLowerCase())) {
      return "Not Moving Forward";
    }

    /**
     * Contact in Future
      Inactive
      Left Voicemail
      Nurture
      Pre Qualified / Pre-Qualified
      Unknown
      Warm
     */

  const nurture = ["Contact in Future", "Inactive", "Left Voicemail", "Nurture", "Pre Qualified", "Unknown", "Warm"];
  if (nurture.some(e => e.toLowerCase() === status.toLowerCase())) {
    return "Nurture";
  }

  console.warn(`⚠️ No mapping found for lead stage "${zohoStatus}"`);
  return null;
}

// Create Lead and associate with contact
async function createLeadForContact(contact, existingId) {
  let leadProperties = {};
  try {
    const filters = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "zoho_lead_id",
              operator: "EQ",
              value: contact.id,
            },
          ],
        },
      ],
      properties: ["id"],
      limit: 1,
    };
    const fetchedLeadId = await hsHelpers.searchDataOnHubspot('leads', filters);
    logger.info(`hubspotfetchedLeadId ${fetchedLeadId}`);
    if (!fetchedLeadId) {
      logger.info(`ontact not found in HubSpot for LeadId: ${contact.id}. create a new lead....`);
    
        const leadStage = leadStatusMap[mapLeadStage(contact.Lead_Status)];

         leadProperties = {
          hs_lead_name: `${contact.Full_Name || ""}`,
          hs_pipeline: "lead-pipeline-id", // ✅ replace with your actual pipeline ID
          hs_pipeline_stage: leadStage,
          zohoownerid: contact.Owner?.id,
          zohoownername: contact.Owner?.name,
          zoho_lead_id: contact.id
        };

        // ✅ Create lead WITH association to contact
        const leadRes = await axios.post(
          "https://api.hubapi.com/crm/v3/objects/leads",
          {
            properties: leadProperties,
            associations: [
              {
                to: { id: existingId },
                types: [
                  {
                    associationCategory: "HUBSPOT_DEFINED",
                    associationTypeId: 578,
                  },
                ],
              },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );

        const leadId = leadRes.data.id;
        logger.info(`✅ Lead created and associated: ${leadId} for contact ${contact.Email}`);
    }
  } catch (err) {
    const errData = err.response?.data || err.message;
    logger.error('an error occur in Lead', errData, leadProperties, 'lead');
  }
}

app.get("/zoho/leads", async (req, res) => {
  const objectType = "Lead";
  let page = 1;
  let moreRecords = true;
  let totalMigrated=0;
  logger.info('Lead Migration Start.....');
  try {
    logger.info('Lead Migration building map....');
    const fieldMap = await buildFieldMap();
    // logger.info(`Lead Migration building map ${JSON.stringify(fieldMap)}`);

    while (moreRecords) {
      logger.info(`Fetching page: ${page}`);

      // const url = `https://www.zohoapis.com/crm/v2/Leads?per_page=5&page=${page}`;
      const url = "https://www.zohoapis.com/crm/v2/Leads/4582160000177951014";

       const contactRes = await zohoApiRequest({
        method: "get",
        url: `${url}`,
      });
      const zohoContacts = contactRes.data.data || [];
      logger.info( `Fetched ${zohoContacts.length} Zoho contacts on page ${page}`)

      if (zohoContacts.length === 0) {
        moreRecords = false;
        break;
      }

      await syncLeadContactsToHubSpot(zohoContacts, fieldMap, objectType);
      moreRecords = contactRes.data.info?.more_records || false;
      page += 1;
    }

    res.status(200).json({ message: "✅ Zoho contacts synced to HubSpot." });
  } catch (error) {
    const errData = error.response?.data;
    if (
      errData?.code === "RATE_LIMIT_EXCEEDED" ||
      errData?.message?.toLowerCase().includes("rate limit") ||
      errData?.code === "TOO_MANY_REQUESTS"
    ) {
      console.error(`⏳ Rate limit hit. Stopping sync.`);
      return res
        .status(429)
        .json({ error: "Rate limit hit. Try again later." });
    }

    console.error("❌ Unhandled error during sync:", errData || error.message);
    res.status(500).json({
      error: "Failed to sync contacts.",
      details: errData || error.message,
    });
  }
});


async function syncLeadContactsToHubSpot(zohoContacts, fieldMap, objectType) {
  const emailStatusMap = {
    "-None-": "NONE",
    "Request is in progress": "Request is in progress",
    Real: "Existing",
    Fake: "Nonexistent",
    Unknown: "Unknown",
    "Out of limit": "Out of limit",
    "Safe to send": "Safe to send",
  };
  const leadStageMap = {
    "intro meeting": "Option 2", // 👈 correct internal value
    "discovery meeting": "Value Proposition (40%)",
    nurture: "Nurture",
    proposal: "Proposal",
    contracting: "Contracting",
    unqualified: "Unqualified",
    qualified: "Option 1",
  };
  const leadTypeMap = {
    "Luke Warm": "Warm",
    Hot: "Hot",
    Cold: "Cold",
    Critical: "Critical",
    "-None-": "-None-",
  };
  const icpMap = {
    Yes: "Yes",
    No: "No",
    "Cant Confirm": "Can't Confirm",
    "-None-": "-None-",
  };
  const leadSourceMap = {
    "-none-": "-None-",
    growth: "Growth",
    organic: "Organic",
    outbound: "Outbound",
    "inside sales": "Inside Sales",
    ppc: "PPC",
    relationship: "Relationship",
    "demo account": "Demo Account",
    "app free trial": "APP_FREE_TRIAL",
    awareness: "AWARENESS",
    casestudydoctustechhelpsboostrafaccuracy: "CASESTUDY",
    "changes between hcc v24 and hcc v28": "VERSION_CHANGES",
    "cold call": "COLD_CALL",
    "cold linkedin outreach": "LINKEDIN_OUTREACH",
    "compliance sme interview": "COMPLIANCE_INTERVIEW",
    "demo account user": "DEMO_USER",
    discovery: "DISCOVERY",
    "ebook measuring the value of value-based care": "EBOOK_VALUE_CARE",
    email: "EMAIL", // 👈 this one matches now
    "existing customer": "EXISTING_CUSTOMER",
    "facebook ads": "FACEBOOK_ADS",
    "hcc audits compliance": "HCC_COMPLIANCE",
    "hcc quick guide": "HCC_GUIDE",
    "integrated platform contact": "INTEGRATED_CONTACT",
    "lead gen form": "LEAD_GEN_FORM",
    "learn about app": "LEARN_ABOUT_APP",
    "learn more - performance max campaign": "PERFORMANCE_MAX",
    "learn with app": "LEARN_APP",
    "learn with doctus": "LEARN_DOCTUS",
    "learn with doctustech": "LEARN_DOCTUSTECH",
    "learn with mobile app": "LEARN_MOBILE_APP",
    "linkedin ads": "LINKEDIN_ADS",
    "linkedin form": "LINKEDIN_FORM",
    "linkedin sales search": "LINKEDIN_SALES_SEARCH",
    "ob aco": "OB_ACO",
    "ob athena": "OB_ATHENA",
    "ob persona": "OB_PERSONA",
    "ob re-engaged": "OB_RE-ENGAGED",
    "personal network": "PERSONAL_NETWORK",
    "radv whitepaper": "RADV_WHITEPAPER",
    "raf revenue calculator": "RAF_REVENUE_CALCULATOR",
    referral: "REFERRAL",
    "risk adjustment one pager": "RISK_ADJUSTMENT_ONE_PAGER",
    "roi calculator": "ROI_Calculator",
    schedule_a_demo: "SCHEDULE1_A_DEMO",
    scupdap: "SCUPDAP",
    seamless: "SEAMLESS",
    "site contact us": "SITE_CONTACT_US",
    tradeshow: "TRADESHOW",
    "visitor insites": "VISITOR_INSITES",
    webinar: "WEBINAR",
    zoominfo: "ZOOMINFO",
    warm: "WARM",
  };
  const leadSourceTypeMap = {
    "-none-": "-None-",
    "demo account": "Demo Account",
    expansion: "Expansion",
    growth: "Growth",
    "inside sales": "Inside Sales",
    organic: "Organic",
    ppc: "PPC",
    relationship: "Relationship",
  };
  const leadStatusMap = {
    "-None-": "NONE",
    Warm: "WARM",
    Nurture: "NURTURE",
    Prospect: "PROSPECT",
    "Meeting - Pending": "MEETING_PENDING",
    "Meeting - Booked": "MEETING_BOOKED",
    "Channel Partner": "CHANNEL_PARTNER",
    Imported: "IMPORTED",
    "PPC - New": "PPC_NEW",
    "Do Not Contact": "DO_NOT_CONTACT",
    "Call me": "CALL_ME",
    Inactive: "INACTIVE",
    Qualified: "QUALIFIED",
    "Is Not Qualified": "IS_NOT_QUALIFIED",
    Unknown: "UNKNOWN",
  };
  const errorLogs = [];

  for (const contact of zohoContacts) {

    let payload = {};
    try {
      if (!contact.Email) continue;
      logger.info(`searching contact via email:- ${contact.Email}`);
      let existingId = await hsHelpers.searchContactInHubSpot(contact.Email);
      const properties = {};  
      for (const [zohoKey, hubspotKeyOriginal] of Object.entries(fieldMap)) {
        if (hubspotKeyOriginal === "lead_stage") {
          logger.info(`⏭️ Skipping lead_stage for ${contact.Email}`);
          continue;
        }
        let hubspotKey = hubspotKeyOriginal;
        let value;

        if (zohoKey === "BDR_Owner") {
          value = contact.BDR_Owner?.name || null;
        } else {
          value = contact[zohoKey];
        }
        if (
          (value !== null &&
            value !== undefined &&
            (typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean")) ||
          Array.isArray(value)
        ) {
          // 🛠 Mapping rules
          if (hubspotKey === "zohocheckeremail__email_status") {
            if (emailStatusMap[value]) {
              properties[hubspotKey] = emailStatusMap[value];
            } else {
              logger.warn(`⚠️ Skipping invalid email status value "${value}" for ${contact.Email}`);
            }
          } else if (
            hubspotKey === "zohocheckeremail__secondary_email_status"
          ) {
            if (emailStatusMap[value]) {
              properties[hubspotKey] = emailStatusMap[value];
            } else {
              logger.warn(
                `⚠️ Skipping invalid email status value "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_stage") {
            const mappedType = leadTypeMap[String(value).toLowerCase()];
            if (mappedType) {
              properties[hubspotKey] = mappedType;
            } else {
              logger.warn(
                `⚠️ Skipping invalid lead type "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_type") {
            const mappedType = leadStageMap[String(value).toLowerCase()];
            if (mappedType) {
              properties[hubspotKey] = mappedType;
            } else {
              logger.warn(
                `⚠️ Skipping invalid lead type "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "icp") {
            const mappedIcp = icpMap[String(value)];
            if (mappedIcp) {
              properties[hubspotKey] = mappedIcp;
            } else {
              logger.warn(
                `⚠️ Skipping invalid icp value "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "linkedin_connected") {
            const linkedinConnected = contact.LinkedIn_Connected;
            logger.info(
              "🟡 Raw linkedinConnected from Zoho:",
              linkedinConnected
            );

            if (
              !Array.isArray(linkedinConnected) ||
              linkedinConnected.length === 0
            ) {
              logger.warn(
                `⚠️ No valid linkedinConnected found for ${contact.Email}`
              );
            } else {
              properties[hubspotKey] = linkedinConnected.join(";");
              logger.info(
                `🟡 Mapped linkedinConnected: ${properties[hubspotKey]}`
              );
            }
          } else if (hubspotKey === "tag") {
            const tag = contact.Tag;
            logger.info("🟡 Raw tag from Zoho:", tag);

            if (!Array.isArray(tag) || tag.length === 0) {
              logger.warn(`⚠️ No valid tag found for ${contact.Email}`);
              properties[hubspotKey] = ""; // ✅ Send empty string if no tags
            } else {
              properties[hubspotKey] = tag.join(";");
              logger.info(`🟡 Mapped tag: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "program") {
            const program = contact.Program;
            logger.info("🟡 Raw program from Zoho:", program);

            if (!Array.isArray(program) || program.length === 0) {
              logger.warn(`⚠️ No valid program found for ${contact.Email}`);
              properties[hubspotKey] = ""; // ✅ Send empty string if no tags
            } else {
              properties[hubspotKey] = program.join(";");
              logger.info(`🟡 Mapped program: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "meeting_type") {
            const meetingTypes = contact.Meeting_Type;

            if (!Array.isArray(meetingTypes) || meetingTypes.length === 0) {
              logger.warn(
                `⚠️ No valid meeting_type found for ${contact.Email}`
              );
            } else {
              properties[hubspotKey] = meetingTypes.join(";");
              logger.info(`🟡 Mapped meeting_type: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "lead_stage") {
            const mappedStage = leadStageMap[String(value).toLowerCase()];
            logger.info("mappedStage----", mappedStage);
            if (mappedStage) {
              properties[hubspotKey] = mappedStage;
            } else {
              logger.warn(
                `⚠️ Skipping invalid lead stage "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_type") {
            const mappedType = leadTypeMap[String(value).toLowerCase()];
            if (mappedType) {
              properties[hubspotKey] = mappedType;
            } else {
              logger.warn(
                `⚠️ Skipping invalid lead type "${value}" for ${contact.Email}`
              );
            }
          } else {
            properties[hubspotKey] = value;
          }
        }
      }
      
      
      // Add Zoho Lead ID manually
      properties["zoho_lead_id"] = contact.id;
      const bdrId = contact.BDR_Owner?.id || "DEFAULT_BDR_ID";
      properties["zoho_bdr_id"] = bdrId;
      const modifiedBy = contact.Modified_By?.id;
      properties["modified_by_id"] = modifiedBy;
      const modifiedByName = contact.Modified_By?.name;
      properties["modified_by_name"] = modifiedByName;
      const modifiedByEmail = contact.Modified_By?.email;
      properties["modified_by_email"] = modifiedByEmail;
      const createdBy = contact.Created_By?.id;
      properties["created_by_id"] = createdBy;
      const createdByName = contact.Created_By?.name;
      properties["created_by_name"] = createdByName;
      const createdByEmail = contact.Created_By?.email;
      properties["created_by_email"] = createdByEmail;
      properties["lead_owner"] = contact.Owner?.id;
      properties["zoho_lead_name"] = contact.Owner?.name;
      properties["zoho_lead_email"] = contact.Owner?.email;
      properties["lead_source_type"] = contact.Lead_Source_Bucket;
      properties["object_status"] = objectType;

      //Lead status mapping
      const zohoStatusvalue = contact.Lead_Status;
      const leadStatusvalue =
      leadStatusMap[String(zohoStatusvalue).toLowerCase()];
      if (leadStatusvalue) {
        properties["lead_contact_status"] = leadStatusvalue;
        logger.info(
          `🟡 Mapped lead_contact_status (custom): ${leadStatusvalue}`
        );
      } else {
        logger.warn(
          `⚠️ Skipping invalid lead_contact_status "${leadStatusvalue}" for ${contact.Email}`
        );
        properties["lead_contact_status"] = 'NONE';
      }

      // Add lead_source from Lead_Source map
      const zohoLeadSource = contact.Lead_Source;
      const mappedLeadSource =
        leadSourceMap[String(zohoLeadSource).toLowerCase()];
      if (mappedLeadSource) {
        properties["lead_source"] = mappedLeadSource;
      } else {
        logger.warn(
          `⚠️ Skipping invalid lead_contact_status "${zohoLeadSource}" for ${contact.Email}`
        );
        properties["lead_source"] = '-None-';
      }

      // Send to HubSpot
      payload = { properties };
      // console.log(`payload ${payload}`);
      logger.info(`📩 Sending contact ${contact.Email} to HubSpot with payload:`);
      
      if (existingId) {
        await axios.patch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );

        logger.info(`✅ Updated contact ${contact.Email}`);
      } else {
        console.log("create");
        const response = await axios.post(
          `https://api.hubapi.com/crm/v3/objects/contacts`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
         existingId = response.data.id;
        // console.log("response", response.data);
        console.log(`✅ Created contact ${contact.Email}`);
      }
      // Create Lead for this contact
      await createLeadForContact(contact, existingId);
      // Process notes for contacts
      // const notes = await activities.processNotesForContacts("leads",contact, access_token, existingId);
      // const tasks = await activities.processTasksForContacts(
      //   "leads",
      //   contact,
      //   access_token,
      //   existingId
      // );
    } catch (err) {
      let errorMessage;
      let message = 'An error occur';
      if (err.response && err.response.data) {
        errorMessage = JSON.stringify(err.response.data, null, 2);
        message += `with status: ${err.response.status}, statusText: ${err.response.statusText}`
      } else {
        errorMessage = err.message;
        message = err.message;
      }
      logger.error(message, errorMessage, payload, 'contact');
    }
  }

}

app.get("/zoho/deals", async (req, res) => {
  let page = 1;
  let moreRecords = true;

  try {
    logger.info('Start deal migration script.....')
    logger.info('start building map...');
    const fieldMap = await buildFieldMap();

    while (moreRecords) {
      logger.info(`📄 Fetching page: ${page}`);

      const url = `https://www.zohoapis.com/crm/v2/Deals?per_page=5&page=${page}`;
      // const url = "https://www.zohoapis.com/crm/v2/Deals/4582160000127574127";

      const dealRes = await zohoApiRequest({
        method: "get",
        url: `${url}`,
      });

      const zohoDeals = dealRes.data.data || [];
      logger.info(
        `📦 Fetched ${zohoDeals.length} Zoho contacts on page ${page}`
      );

      if (zohoDeals.length === 0) {
        moreRecords = false;
        break;
      }

      await syncDealsToHubSpot(zohoDeals, fieldMap);

      moreRecords = dealRes.data.info?.more_records || false;
      page += 1;
      // break;
    }

    res.status(200).json({ message: "✅ Zoho contacts synced to HubSpot." });
  } catch (error) {
    const errData = error.response?.data;

    if (errData?.code === "INVALID_TOKEN") {
      console.warn("⚠️ Access token invalid. Refreshing...");
      access_token = await refreshAccessToken(); // You must implement this if not already
      return res
        .status(401)
        .json({ message: "Token refreshed. Please retry." });
    }

    if (
      errData?.code === "RATE_LIMIT_EXCEEDED" ||
      errData?.message?.toLowerCase().includes("rate limit") ||
      errData?.code === "TOO_MANY_REQUESTS"
    ) {
      console.error(`⏳ Rate limit hit. Stopping sync.`);
      return res
        .status(429)
        .json({ error: "Rate limit hit. Try again later." });
    }

    console.error("❌ Unhandled error during sync:", errData || error.message);
    res.status(500).json({
      error: "Failed to sync contacts.",
      details: errData || error.message,
    });
  }
});

async function syncDealsToHubSpot(zohoDeals, fieldMap) {

  const leadStatusMap = {
    '-None-': '-None-',
    Warm: 'Warm',
    Nurture: 'Nurture',
    Prospect: 'Prospect',
    'Meeting - Pending': 'Meeting - Pending',
    'Meeting - Booked': 'Meeting - Booked',
    'Channel Partner': 'Channel Partner',
    Imported: 'Imported',
    'PPC - New': 'PPC - New',
    'Do Not Call': 'Do Not Call',
    'Call me': 'Call me',
    Inactive: 'Inactive',
    Qualified: 'Qualified',
    'SQL Qualified': 'SQL Qualified'
  };

  const industryMap = {
    '-None-': '-None-',
    'Health, Wellness & Fitness': 'Health, Wellness & Fitness',
    Insurance: 'Insurance',
    'Medical Practice': 'Medical Practice',
    'Hospital & Health Care': 'Hospital & Health Care',
    'Hospitals & Physicians Clinics': 'Hospitals & Physicians Clinics'
  };
  const leadSourceMap = {
      "-none-": "-None-",
      "campaign email": "CAMPAIGN_EMAIL",
      awareness: "AWARENESS",
      casestudydoctustechhelpsboostrafaccuracy: "CASESTUDY",
      "changes between hcc v24 and hcc v28": "VERSION_CHANGES",
      chat: "CHAT",
      cleverly: "CLEVERLY",
      "cold call": "COLD_CALL",
      "cold linkedin outreach": "LINKEDIN_OUTREACH",
      "compliance sme interview": "COMPLIANCE_INTERVIEW",
      "ebook measuring the value of value-based care": "EBOOK_VALUE_CARE",
      email: "EMAIL",
      expansion: "EXPANSION",
      "facebook ads": "FACEBOOK_ADS",
      growth: "Growth",
      "hcc quick guide": "HCC_GUIDE",
      inbound: "INBOUND",
      "integrated platform contact": "INTEGRATED_CONTACT",
      "learn more - performance max campaign": "PERFORMANCE_MAX",
      "learn with app": "LEARN_APP",
      "linkedin form": "LINKEDIN_FORM",
      "linkedin sales search": "LINKEDIN_SALES_SEARCH",
      "linkedin salesnav": "LINKEDIN_SALESNAV",
      "noi digital": "NOI_DIGITAL",
      "ob aco": "OB_ACO",
      "ob athena": "OB_ATHENA",
      "ob persona": "OB_PERSONA",
      "ob re-engaged": "OB_RE-ENGAGED",
      "oppt drive": "OPPT_DRIVE",
      "personal network": "PERSONAL_NETWORK",
      ppc: "PPC",
      "radv whitepaper": "RADV_WHITEPAPER",
      "raf revenue calculator": "RAF_REVENUE_CALCULATOR",
      referral: "REFERRAL",
      "risk adjustment one pager": "RISK_ADJUSTMENT_ONE_PAGER",
      "schedule a demo": "SCHEDULE1_A_DEMO",
      scupdap: "SCUPDAP",
      seamless: "SEAMLESS",
      "site contact us": "SITE_CONTACT_US",
      "visitor insites": "VISITOR_INSITES",
      webinar: "WEBINAR",
      website: "WEBSITE",
      "website visit": "WEBSITE_VISIT",
      yamm: "YAMM",
      "zoominfo sales search": "ZOOMINFO_SALES_SEARCH",
    };
  const normalize = (str) =>
    String(str || "")
      .trim()
      .toLowerCase();

  for (const deals of zohoDeals) {

    logger.info("deals.Deal_Name ", deals.Deal_Name);
    let payload = {};
    try {
      if (!deals.Deal_Name) {
        logger.warn("⛔ Skipping deal with missing Deal_Name.");
        continue;
      }
      const existingId = await hsHelpers.searchDealInHubSpot(deals.Deal_Name);

      const properties = {};

      logger.info("📋 Mapping Zoho fields to HubSpot properties...");
      for (const [zohoKey, hubspotKey] of Object.entries(fieldMap)) {
        const value = deals[zohoKey];
        if (!value) continue;

        const valueStr = String(value).trim();
        const normalizedValue = normalize(valueStr);
        if (
          (value !== null &&
            value !== undefined &&
            (typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean")) ||
          Array.isArray(value)
        ) {
          // 🛠 Mapping rules
          if (hubspotKey === "meeting_type") {
            const meetingTypes = deals.Meeting_Type;

            if (!Array.isArray(meetingTypes) || meetingTypes.length === 0) {
              logger.warn(`⚠️ No valid meeting_type found for ${deals.Email}`);
            } else {
              properties[hubspotKey] = meetingTypes.join(";");
              logger.info(`🟡 Mapped meeting_type: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "linkedin_connected") {
            const linkedinConnected = deals.LinkedIn_Connected;
            logger.info(
              "🟡 Raw linkedinConnected from Zoho:",
              linkedinConnected
            );

            if (
              !Array.isArray(linkedinConnected) ||
              linkedinConnected.length === 0
            ) {
              logger.warn(
                `⚠️ No valid linkedinConnected found for ${deals.Email}`
              );
            } else {
              properties[hubspotKey] = linkedinConnected.join(";");
              logger.info(
                `🟡 Mapped linkedinConnected: ${properties[hubspotKey]}`
              );
            }
          } else if (hubspotKey === "tag") {
            const tag = deals.Tag;
            logger.info("🟡 Raw tag from Zoho:", tag);

            if (!Array.isArray(tag) || tag.length === 0) {
              logger.warn(`⚠️ No valid tag found for ${deals.Email}`);
              properties[hubspotKey] = ""; // ✅ Send empty string if no tags
            } else {
              properties[hubspotKey] = tag.join(";");
              logger.info(`🟡 Mapped tag: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "program") {
            const program = deals.Program;
            logger.info("🟡 Raw program from Zoho:", program);

            if (!Array.isArray(program) || program.length === 0) {
              logger.warn(`⚠️ No valid program found for ${deals.Email}`);
              properties[hubspotKey] = ""; // ✅ Send empty string if no tags
            } else {
              properties[hubspotKey] = program.join(";");
              logger.info(`🟡 Mapped program: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "phone") {
            logger.info("🟡 Raw phone from Zoho:", deals.Phone);
            properties["phone"] = deals.Phone;
            logger.info(`📞 Added property: phone = "${deals.Phone}"`);
          } else {
            properties[hubspotKey] = value;
          }
        }
      }

      const zohoOwnerId = deals.Owner?.id?.trim();
      logger.info(`🆔 Zoho Owner ID: ${zohoOwnerId}`);
      if (!zohoOwnerId || isNaN(zohoOwnerId)) {
        console.warn(
          `⚠️ Invalid or unmapped HubSpot owner ID for Zoho owner ID: ${zohoOwnerId}`
        );
        continue; // skip or handle appropriately
      }
      properties["cost_per_click"] = deals.Cost_per_Click;
      properties["cost_per_conversion"] = deals.Cost_per_Conversion;
      properties["campaign_source_id"] = deals.Campaign_Source?.id;
      properties["campaign_source_name"] = deals.Campaign_Source?.name;
      properties["phone"] = deals.Phone;
      properties["description"] = deals.Description;
      properties["zoho_deal_id"] = deals.id;
      properties["zoho_deal_owner_id"] = deals.Owner?.id;
      properties["lead_owner_id"] = deals.Lead_Owner?.id;
      properties["deal_name"] = deals.Deal_Name;
      logger.info(`✅ Added property: deal_name = "${deals.Deal_Name}"`);
      properties["ownerid"] = zohoOwnerId;
      properties["email"] = deals.Email;
      logger.info(` Added property: email = "${deals.Email}"`);
      properties["title"] = deals.Title;
      logger.info(`✅ Added property: title = "${deals.Title}"`);
      properties["account_id"] = deals.Account_Name?.id;
      logger.info(
        `✅ Added property: account_id = "${deals.Account_Name?.id}"`
      );
      properties["account_name"] = deals.Account_Name?.name;
      logger.info(
        `✅ Added property: account_name = "${deals.Account_Name?.name}"`
      );
      properties["zoho_bdr_id"] = deals.BDR_Owner?.id;
      logger.info(`✅ Added property: zoho_bdr_id = "${deals.BDR_Owner?.id}"`);
      properties["product_type_new"] = deals.Product_Type_new;
      logger.info(
        `✅ Added property: product_type_new = "${deals.Product_Type_new}"`
      );
      const modifiedById = deals.Modified_By?.id;
      properties["modified_by_id"] = modifiedById;
      const modifiedByName = deals.Modified_By?.name;
      properties["modified_by_name"] = modifiedByName;
      const modifiedByEmail = deals.Modified_By?.email;
      properties["modified_by_email"] = modifiedByEmail;
      const createdBy = deals.Created_By?.id;
      properties["created_by_id"] = createdBy;
      const createdByName = deals.Created_By?.name;
      properties["created_by_name"] = createdByName;
      const createdByEmail = deals.Created_By?.email;
      properties["created_by_email"] = createdByEmail;
      properties["probability"] = deals.Probability;
      properties["created_time"] = convertToUtcMillis(deals.Created_Time);
      properties["modified_time"] = convertToUtcMillis(deals.Modified_Time);
      properties["last_activity_time"] = convertToUtcMillis(
        deals.Last_Activity_Time
      );
      let zohoLeadSource = deals.Lead_Source;
      logger.info(`📧 Lead_Source: ${zohoLeadSource}`);
      zohoLeadSource = zohoLeadSource?.trim()?.toLowerCase();
      const mappedLeadSource = leadSourceMap[zohoLeadSource?.trim()];

      logger.info(`📧 Mapped lead_source: ${mappedLeadSource}`);
      if (mappedLeadSource) {
        properties["lead_source"] = mappedLeadSource;
      } else {
        console.warn(
          `⚠️ Skipping invalid lead_contact_status "${zohoLeadSource}" for ${deals.Email}`
        );
        properties["lead_source"] = '-None-';
      }

      const zohoLeadStatus = deals.Lead_Status
      const mappedLeadStatus = leadStatusMap[zohoLeadStatus?.trim()];
      if(mappedLeadStatus){
         properties["lead_status"] = mappedLeadStatus;
      }else{
         properties["lead_status"] = '-None-';
      }

      const zohoIndustryStatus = deals.Industry
      const mappedIndustryStatus = industryMap[zohoIndustryStatus?.trim()];
      if(mappedIndustryStatus){
         properties["industry"] = mappedIndustryStatus;
      }else{
         properties["industry"] = '-None-';
      }

      // 🛠 Pipeline and Stage Fix
      const displayLabelRaw =
        deals?.$layout_id?.display_label || "Sales Pipeline";
      const displayLabel = normalize(displayLabelRaw);

      const pipelineMapping = {
        "sales pipeline": "default",
        standard: "default",
      };

      const matchedPipelineKey = Object.keys(pipelineMapping).find(
        (key) => normalize(key) === displayLabel
      );

      const pipelineId = pipelineMapping[matchedPipelineKey] || "default";
      properties["pipeline"] = pipelineId;

      const dealStageMapping = {
        "sales pipeline": {
          sal: "1847181023",
          qualification: "appointmentscheduled",
          evaluation: "qualifiedtobuy",
          proposal: "presentationscheduled",
          commit: "decisionmakerboughtin",
          "closed lost": "closedlost",
          "closed won": "closedwon",
        },
        standard: {
          sal: "1847181023",
          qualification: "appointmentscheduled",
          evaluation: "qualifiedtobuy",
          proposal: "presentationscheduled",
          commit: "decisionmakerboughtin",
          "closed lost": "closedlost",
          "closed won": "closedwon",
        },
      };

      const stageRaw = deals?.Stage || "";
      const stageLabel = normalize(stageRaw);
      const matchedStageKey = Object.keys(
        dealStageMapping[matchedPipelineKey] || {}
      ).find((stage) => normalize(stage) === stageLabel);

      if (matchedStageKey) {
        const stageId = dealStageMapping[matchedPipelineKey][matchedStageKey];
        properties["dealstage"] = stageId; // 🛠 corrected property name
        logger.info(`✅ Deal stage mapped: ${stageRaw} -> ${stageId}`);
      } else {
        logger.warn(
          `⚠️ Stage "${stageRaw}" not mapped for pipeline "${matchedPipelineKey}"`
        );
      }

      // ✅ Final payload
      payload = { properties };
      logger.info(`📤 Sending deal: "${deals.Deal_Name}"`, payload);

      const hubspotUrl = existingId
        ? `https://api.hubapi.com/crm/v3/objects/deals/${existingId}`
        : `https://api.hubapi.com/crm/v3/objects/deals`;

      const method = existingId ? axios.patch : axios.post;

      await method(hubspotUrl, payload, {
        headers: {
          Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      logger.info(
        `✅ Deal ${existingId ? "updated" : "created"}: "${deals.Deal_Name}"`
      );
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        JSON.stringify(err.response?.data) ||
        err.message;
      logger.error(`❌ Error syncing deal "${deals.Deal_Name}":`, errorMessage, payload, 'deal');
    }
  }
}

app.get("/zoho/users/sync", async (req, res) => {
  // console.log("hi.........................")
  try {
    // const access_token = '1000.aced0f140ce2b0d80dd21452555aae2d.6f82121fa0c45ce3ae9e37187211f0c6'
    const access_token = await getZohoAccessToken();
    console.log("access_token", access_token);
    const users = await fetchUsersFromZoho(access_token);

    for (const user of users) {
      if (!user.email) {
        console.warn("⚠️ Skipping user with no email:", user);
        continue;
      }

      await createUserInHubSpotAsContact(user);
      const hubspotUsers = await getHubSpotUsers();
      // console.log("hubspotUsers", hubspotUsers);
    }

    res.status(200).json({
      message: "✅ Zoho users fetched and synced to HubSpot as contacts.",
    });
  } catch (err) {
    console.error("❌ Error syncing Zoho users to HubSpot:", err);
    res.status(500).json({ error: err.message });
  }
});

async function syncAccountsToHubSpot(zohoAccounts, fieldMap) {
  const leadStatusMap = {
    "-None-": "NONE",
    Qualified: "QUALIFIED",
    "Not Qualified": "NOT_QUALIFIED",
    Nurture: "NURTURE",
    "Do Not Contact": "DO_NOT_CONTACT",
    "Channel Partner": "CHANNEL_PARTNER",
    Inactive: "INACTIVE",
    Warm: "WARM",
    Prospect: "PROSPECT",
    "Meeting - Pending": "MEETING_PENDING",
    "Meeting - Booked": "MEETING_BOOKED",
    Imported: "IMPORTED",
    "PPC - New": "PPC_NEW",
    "Do Not Call": "DO_NOT_CALL",
    "Call me": "CALL_ME",
    "SQL Qualified": "SQL_QUALIFIED",
  };

  const leadSourceMap = {
    "-none-": "-None-",
    "campaign email": "Campaign Email",
    "scu pdap": "SCU PDAP",
    chat: "Chat",
    cleverly: "Cleverly",
    "cold call": "Cold Call",
    "cold linkedin outreach": "Cold LinkedIn Outreach",
    growth: "Growth",
    "linkedin sales search": "LinkedIn Sales Search",
    "zoominfo sales search": "ZoomInfo Sales Search",
    "hcc audits compliance": "HCC Audits Compliance",
    "hcc quick guide": "HCC QUICK GUIDE",
    inbound: "Inbound",
    "integrated platform contact": "INTEGRATED PLATFORM CONTACT",
    "learn with app": "LEARN WITH APP",
    "linkedin form": "LINKEDIN FORM",
    "linkedin salesnav": "LinkedIn SalesNav",
    "noi digitial": "NOI Digitial",
    "oppt drive": "Oppt Drive",
    "personal network": "Personal Network",
    "prior connection": "Prior Connection",
    "radv whitepaper": "RADV WHITEPAPER",
    referral: "Referral",
    "schedule a demo": "SCHEDULE A DEMO",
    seamless: "Seamless",
    "site contact us": "SITE CONTACT US",
    "visitor insites": "Visitor InSites",
    webinar: "Webinar",
    "website visit": "Website Visit",
    yamm: "YAMM",
    "learn more - performance max campaign":
      "Learn More - Performance Max Campaign",
    "ob aco": "OB ACO",
    "ob persona": "OB Persona",
    "ob re-engaged": "OB Re-Engaged",
    "ob athena": "OB Athena",
    "changes between hcc v24 and hcc v28":
      "Changes between HCC V24 and HCC V28",
    "ebook measuring the value of value-based care":
      "Ebook Measuring the value of value-based care",
    "compliance sme interview": "Compliance SME interview",
    "raf revenue calculator": "RAF revenue calculator",
    "risk adjustment one pager": "Risk adjustment one pager",
    casestudydoctustechhelpsboostrafaccuracy:
      "CasestudyDoctusTechHelpsboostRAFaccuracy",
  };

  const leadTypeMap = {
    critical: "Critical",
    hot: "Hot",
    warm: "Warm",
    cold: "Cold",
    "-none-": "-None-",
  };

  const categoryMap = {
    "-none-": "-None-",
    "primary care": "Primary Care",
    "palliative care": "Palliative Care",
    "aco / aco reach": "ACO",
    aco: "ACO",
    other: "Other",
  };
  const leadSourceTypeMap = {
    "-none-": "-None-",
    growth: "Growth",
    organic: "Organic",
    referral: "Referral",
    outbound: "Outbound",
    "inside sales": "Inside Sales",
    ppc: "PPC",
    relationship: "Relationship",
  };

  const errorLogs = [];

  const normalize = (str) =>
    String(str || "")
      .trim()
      .toLowerCase();

  for (const accounts of zohoAccounts) {
    try {
      if (!accounts.Email) continue;

      const existingId = await hsHelpers.searchCompanyInHubSpot(
        accounts.Account_Name
      );
      console.log("existingId", existingId);
      const properties = {};

      for (const [zohoKey, hubspotKey] of Object.entries(fieldMap)) {
        let value = accounts[zohoKey];

        if (
          value !== null &&
          value !== undefined &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean")
        ) {
          const valueStr = String(value).trim();
          const normalizedValue = normalize(valueStr);
          // console.log("normalizedValue", normalizedValue);
          if (hubspotKey === "lead_type") {
            const mapped = leadTypeMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              continue;
            } else {
              console.warn(
                `⚠️ Skipping invalid lead_type "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }

          if (hubspotKey === "lead_source_type") {
            const mapped = leadSourceTypeMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              continue;
            } else {
              // properties[hubspotKey]=accounts.Lead_Source
              console.warn(
                `⚠️ Skipping invalid lead_source_type "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }

          if (hubspotKey === "category") {
            const mapped = categoryMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              continue;
            } else {
              console.warn(
                `⚠️ Skipping invalid category "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }
          if (hubspotKey === "industry") {
            const mapped = industryMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              continue;
            } else {
              console.warn(
                `⚠️ Skipping invalid category "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }
          if (hubspotKey === "lead_source") {
            const mapped = leadSourceMap[normalizedValue];
            console.log("mapped", mapped);
            if (mapped) {
              console.log("hubspotKey", hubspotKey);
              properties[hubspotKey] = mapped;
              continue;
            } else {
              // console.log("valueStr", valueStr);
              properties[hubspotKey] = accounts.Lead_Source;
              console.warn(
                `⚠️ Skipping invalid lead_source "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }
          if (hubspotKey === "title") {
            console.warn(
              `⏭️ Skipping unmapped property "title" for ${accounts.Email}`
            );
            continue;
          }

          // fallback if not a mapped field
          properties[hubspotKey] = valueStr;
        }
      }
      // Add Zoho Lead ID manually
      properties["zoho_company_id"] = accounts.id;
      console.log(`🆔 Added Zoho_Company_Id: ${accounts.id}`);

      // Add BDR ID
      const bdrId = accounts.BDR_Owner?.id || "DEFAULT_BDR_ID";
      properties["zoho_bdr_id"] = bdrId;
      console.log(`👤 Added zoho_bdr_id: ${bdrId}`);

      const zohoStatus = accounts.Status;
      const mappedStatus = leadStatusMap[zohoStatus];
      if (mappedStatus) {
        properties["company_status"] = mappedStatus;
      } else {
        console.warn(
          `⚠️ Skipping invalid company_status "${zohoStatus}" for ${accounts.Email}`
        );
      }

      const payload = { properties };
      console.log(
        `📩 Sending account ${accounts.Email} to HubSpot with payload:`,
        payload
      );

      if (existingId) {
        await axios.patch(
          `https://api.hubapi.com/crm/v3/objects/companies/${existingId}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`✅ Updated account ${accounts.Email}`);
      } else {
        await axios.post(
          `https://api.hubapi.com/crm/v3/objects/companies`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`✅ Created account ${accounts.Email}`);
      }
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        JSON.stringify(err.response?.data) ||
        err.message;
      console.error(`❌ Error syncing ${accounts.Email}:`, errorMessage);
      errorLogs.push({
        contactId: accounts.id,
        email: accounts.Email,
        error: errorMessage,
      });
    }
  }

  if (errorLogs.length > 0) {
    fs.writeFileSync(
      CONTACT_ERROR_LOG_FILE,
      JSON.stringify(errorLogs, null, 2)
    );
    console.log(
      `📁 Logged ${errorLogs.length} account sync errors to ${CONTACT_ERROR_LOG_FILE}`
    );
  }
}

app.get("/zoho/accounts", async (req, res) => {
  // let tokenObj = await getZohoAccessToken();
  // let access_token = tokenObj.access_token;
  let access_token =
    "1000.dfdcdeb8ebc7d3163957f46b0256e186.ac0609517833953aa1dbce17c416a9ed";

  // let page = 1;
  // let moreRecords = true;

  try {
    const fieldMap = await buildFieldMap(access_token);
    console.log("🔗 Final Mapping:", fieldMap);

    // while (moreRecords) {
    // console.log(`📄 Fetching page: ${page}`);

    // const url = `https://www.zohoapis.com/crm/v2/Leads?per_page=5&page=${page}`;
    // const url = "https://www.zohoapis.com/crm/v2/Accounts/4582160000171491017";
    const url = "https://www.zohoapis.com/crm/v2/Accounts/4582160000116722036";

    const accountRes = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${access_token}`,
      },
    });

    const zohoAccounts = accountRes.data.data || [];
    console.log("zohoAccounts", zohoAccounts);
    // console.log(`📦 Fetched ${zohoAccounts.length} Zoho contacts on page ${page}`);

    // if (zohoContacts.length === 0) {
    //   moreRecords = false;
    //   break;
    // }

    await syncAccountsToHubSpot(zohoAccounts, fieldMap);

    // moreRecords = contactRes.data.info?.more_records || false;
    // page += 1;
    // }

    res.status(200).json({ message: "✅ Zoho contacts synced to HubSpot." });
  } catch (error) {
    const errData = error.response?.data;

    if (errData?.code === "INVALID_TOKEN") {
      console.warn("⚠️ Access token invalid. Refreshing...");
      access_token = await refreshAccessToken(); // You must implement this if not already
      return res
        .status(401)
        .json({ message: "Token refreshed. Please retry." });
    }

    if (
      errData?.code === "RATE_LIMIT_EXCEEDED" ||
      errData?.message?.toLowerCase().includes("rate limit") ||
      errData?.code === "TOO_MANY_REQUESTS"
    ) {
      console.error(`⏳ Rate limit hit. Stopping sync.`);
      return res
        .status(429)
        .json({ error: "Rate limit hit. Try again later." });
    }

    console.error("❌ Unhandled error during sync:", errData || error.message);
    res.status(500).json({
      error: "Failed to sync contacts.",
      details: errData || error.message,
    });
  }
});
async function fetchUsersFromZoho(access_token) {
  // console.log("access_token", access_token);
  const url = `https://www.zohoapis.com/crm/v2/users`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${access_token}`,
      },
    });
    // console.log("response", response);
    const users = response.data.users || [];
    // console.log("users", users);
    // console.log(`✅ Retrieved ${users.length} users from Zoho`);
    return users;
  } catch (error) {
    console.error(
      "❌ Error fetching users from Zoho:",
      error.response?.data || error.message
    );
    throw error;
  }
}
async function getHubSpotUsers() {
  try {
    const response = await axios.get(
      `https://api.hubapi.com/settings/v3/users`,
      {
        headers: {
          Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
        },
      }
    );

    const users = response.data || [];
    console.log(`✅ Retrieved ${users.length} HubSpot users`);
    return users;
  } catch (error) {
    console.error(
      "❌ Error fetching HubSpot users:",
      error.response?.data || error.message
    );
    return [];
  }
}
async function createUserInHubSpotAsContact(user) {
  // console.log("userid", user);
  try {
    const url = `https://api.hubapi.com/settings/v3/users`;

    const body = {
      properties: {
        firstname: user.first_name || "",
        lastname: user.last_name || "",
        email: user.email || "",
      },
    };

    const response = await axios.post(url, body.properties, {
      headers: {
        Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    // console.log("response5746546", response.data);
    console.log(`✅ Created user in HubSpot: ${user.email}`);
    return response.data;
  } catch (error) {
    console.error(
      `❌ Failed to create HubSpot contact for ${user.email}:`,
      error.response?.data || error.message
    );
  }
}

function convertToUtcMillis(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date) ? null : date.getTime();
}

// 🌐 Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
