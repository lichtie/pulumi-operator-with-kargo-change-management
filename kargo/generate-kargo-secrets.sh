#!/bin/bash

# Generate Kargo admin credentials
echo "Generating Kargo admin credentials..."
echo ""

# Generate password
pass=$(openssl rand -base64 48 | tr -d "=+/" | head -c 32)
echo "Password: $pass"
echo ""

# Hash password
hashed_pass=$(htpasswd -bnBC 10 "" $pass | tr -d ':\n')

# Generate signing key
signing_key=$(openssl rand -base64 48 | tr -d "=+/" | head -c 32)

echo "Setting Pulumi config secrets..."
pulumi config set --secret kargoAdminPasswordHash "$hashed_pass"
pulumi config set --secret kargoTokenSigningKey "$signing_key"

echo ""
echo "✓ Secrets configured successfully!"
echo ""
echo "Save this password securely - you'll need it to log in to Kargo:"
echo "Password: $pass"
