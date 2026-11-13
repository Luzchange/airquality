# TSI external API integration notes

Base: https://api-prd.tsilink.com/api/v3/external
POST /oauth/client_credential/accesstoken?grant_type=client_credentials with Content-Type application/x-www-form-urlencoded and URL-encoded client_id/client_secret from server environment. Cache access_token using expires_in; no refresh token flow.
GET /devices and GET /telemetry: Authorization Bearer token, Accept application/json. Devices have device_id and metadata.friendlyName/latitude/longitude. Telemetry has cloud_account_id/cloud_device_id/cloud_timestamp, nested metadata.location, system_status/system_status_int and sensors[]. Each sensor has serial/model/type/status/status_int and measurements[]. Measurement has type/unit/data.timestamp/data.value. Read the measurement timestamp; cloud receipt time is not a substitute.

Supported measurement types: mcpm2x5, mcpm10, co2_ppm, temperature, rh. Current normalized storage does not retain full raw telemetry, cloud_timestamp or original status arrays; it preserves valid/flagged QC only. Add raw source storage and audit provenance for quality-critical deployment.

History parameters: start_date and end_date RFC3339 inclusive; start_date cannot be older than 90 days. age is 1..90. latest_as_of_date also cannot be older than 90 days. device_id is singular. No documented paging or quota numbers; do not invent them. Current sync queries all authorized devices in one-day windows and upserts overlapping boundaries. Check actual response completeness before reliance.

Flat-format telemetry exists but needs repeated telem[] measurement parameters and offers less QC context. The app uses nested telemetry instead. Never apply user calibration factors again without knowing whether values already incorporate them. Never reinterpret concentration as official AQI.
