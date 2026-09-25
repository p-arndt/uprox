Gateway denials are logged as `gateway.<endpoint>` with status `deny` instead of `policy.deny`, so they count in the usage figures and the audit Gateway filter; older rows keep `policy.deny`
