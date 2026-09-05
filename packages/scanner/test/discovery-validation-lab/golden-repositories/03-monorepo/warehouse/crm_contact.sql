CREATE VIEW crm_contact AS
SELECT
  customer_id AS contact_id,
  email AS mail,
  name AS display_name
FROM core_customer;
