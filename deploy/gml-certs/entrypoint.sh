#!/bin/bash
cp /certs/politempire.org.crt /usr/local/share/ca-certificates/ 2>/dev/null
update-ca-certificates 2>/dev/null
exec dotnet /app/Gml.Web.Api.dll
