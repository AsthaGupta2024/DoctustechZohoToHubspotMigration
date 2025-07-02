require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const DESTINATION_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
const BASE_URI = process.env.BASE_URI;

const searchContactInHubSpot = async (contactEmail) => {

  console.log("Searching for contactEmail:", contactEmail);
  const filters = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "email", // Replace with your custom property name if different
            operator: "EQ",
            value: contactEmail,
          },
        ],
      },
    ],
    properties: ["email"],
    limit: 1,
  };
  return searchDataOnHubspot("contacts", filters);
};

const searchCompanyInHubSpot = async (companyName) => {
  console.log("🔍 Searching for company:", companyName);

  const filters = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "account_name",
            operator: "CONTAINS_TOKEN",  // ✅ more robust
            value: companyName.trim(),
          },
        ],
      },
    ],
    properties: ["account_name"],
    limit: 1,
  };

  return searchDataOnHubspot("companies", filters);
};


async function searchDataOnHubspot(objectType, filters) {
  // console.log("hiiiiiiiiiiiiiiiiiiiiiiiiii");
  try {
    console.log("DESTINATION_ACCESS_TOKEN", DESTINATION_ACCESS_TOKEN);
    // console.log("filters", filters);
    // console.log("objectType", objectType);
    const response = await axios.post(
      `${BASE_URI}/crm/v3/objects/${objectType}/search`,
      filters,
      {
        headers: {
          Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    // console.log("responseofei", response.data);
    return response.data.results.length > 0 ? response.data.results[0].id : null;
  } catch (error) {
    console.error(`Error searching ${objectType}:`, error.message);
    return null;
  }
}

const searchDealInHubSpot = async (dealName) => {
  console.log("Searching for dealName:", dealName);

  const filters = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "dealname",
            operator: "EQ",
            value: dealName,
          },
        ],
      },
    ],
    properties: ["dealname"],
    limit: 1,
  };

  console.log("filters", JSON.stringify(filters, null, 2));
  return searchDataOnHubspot("deals", filters);
};


async function searchLineItemBySKU(sku) {
  try {
    const response = await axios.post(
      `${BASE_URI}/crm/v3/objects/line_items/search`,
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "hs_sku",
                operator: "EQ",
                value: sku,
              },
            ],
          },
        ],
        properties: ["hs_object_id", "hs_sku"],
        limit: 1,
      },
      {
        headers: {
          Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.total > 0 && response.data.results.length > 0) {
      return response.data.results[0].id;
    }

    return null;
  } catch (error) {
    console.error(`Error searching for line item by SKU ${sku}:`, error.response?.data || error.message);
    return null;
  }
}

async function updateLineItem(lineItemId, item, sku) {
  try {
    const billingPeriod = 'monthly'; // or dynamically use item?.Tenure if it's valid

    const response = await axios.patch(
      `${BASE_URI}/crm/v3/objects/line_items/${lineItemId}`,
      {
        properties: {
          // hs_recurring_billing_period: item?.Tenure,
          hs_recurring_billing_period: billingPeriod,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.id;
  } catch (err) {
    console.error("Error updating line item:", err.response?.data || err.message);
    return null;
  }
}

async function createLineItem(item, sku) {
  try {
    const response = await axios.post(
      `${BASE_URI}/crm/v3/objects/line_items`,
      {
        properties: {
          hs_sku: sku,
          name: item?.Product?.name,
          quantity: item?.Quantity_in_Demand_1,
          price: item?.Unit_Price_1,
          hs_discount: item?.Discount2 || 0,
          term: item?.Tenure,
          recurringbillingfrequency: item?.Billing_Frequency,
          hs_recurring_billing_start_date: item?.Created_Time,
          price: item?.Total,


        },
      },
      {
        headers: {
          Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.id;
  } catch (err) {
    console.error("Error creating line item:", err.response?.data || err.message);
    return null;
  }
}
async function searchProductInHubSpotByName(name) {
  try {
    const response = await axios.post(
      `${BASE_URI}/crm/v3/objects/products/search`,
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "name",
                operator: "EQ",
                value: name
              }
            ]
          }
        ],
        properties: ["hs_sku"]
      },
      {
        headers: {
          Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const product = response.data?.results?.[0];
    return product?.properties?.hs_sku || null;
  } catch (error) {
    console.error("Error searching for product by name:", error.response?.data || error.message);
    return null;
  }
}

async function associateLineItemToDeal(dealId, lineItemId) {
  try {
    // console.log("ennfkjdkjd");
    await axios.put(
      `${BASE_URI}/crm/v3/objects/deals/${dealId}/associations/line_items/${lineItemId}/deal_to_line_item`,
      {},
      {
        headers: {
          Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(`Error associating line item ${lineItemId} to deal ${dealId}:`, error.response?.data || error.message);
  }
}

async function getHubSpotContactIdByEmail(email, accessToken) {
  const url = `https://api.hubapi.com/crm/v3/objects/contacts/search`;
  try {
    const response = await axios.post(
      url,
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "email",
                operator: "EQ",
                value: email,
              },
            ],
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.results[0]?.id || null;
  } catch (error) {
    console.error(
      "Error retrieving HubSpot contact ID:",
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

module.exports = {
  searchDealInHubSpot,
  searchLineItemBySKU,
  updateLineItem,
  createLineItem,
  searchProductInHubSpotByName,
  associateLineItemToDeal,
  searchContactInHubSpot,
  getHubSpotContactIdByEmail,
  searchCompanyInHubSpot
};