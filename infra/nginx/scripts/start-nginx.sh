#!/bin/sh
set -eu

TLS_MODE="${TLS_MODE:-external}"
SERVER_NAME="${SERVER_NAME:-_}"

EXTERNAL_CERT_PATH="${EXTERNAL_CERT_PATH:-/etc/nginx/ssl/fullchain.pem}"
EXTERNAL_KEY_PATH="${EXTERNAL_KEY_PATH:-/etc/nginx/ssl/privkey.pem}"

INTERNAL_CA_CN="${INTERNAL_CA_CN:-ITMA Internal CA}"
INTERNAL_CA_DAYS="${INTERNAL_CA_DAYS:-3650}"
INTERNAL_CERT_CN="${INTERNAL_CERT_CN:-itma.internal}"
INTERNAL_CERT_DAYS="${INTERNAL_CERT_DAYS:-825}"

INTERNAL_CA_DIR="/etc/nginx/ssl/internal-ca"
INTERNAL_CERT_DIR="/etc/nginx/ssl/internal"
INTERNAL_CA_KEY="${INTERNAL_CA_DIR}/ca.key.pem"
INTERNAL_CA_CERT="${INTERNAL_CA_DIR}/ca.crt.pem"
INTERNAL_SERVER_KEY="${INTERNAL_CERT_DIR}/privkey.pem"
INTERNAL_SERVER_CERT="${INTERNAL_CERT_DIR}/cert.pem"
INTERNAL_SERVER_FULLCHAIN="${INTERNAL_CERT_DIR}/fullchain.pem"
INTERNAL_SERVER_CSR="${INTERNAL_CERT_DIR}/server.csr.pem"
INTERNAL_SERVER_EXT="${INTERNAL_CERT_DIR}/server.ext"

CERT_PATH=""
KEY_PATH=""

generate_internal_ca_if_needed() {
  mkdir -p "${INTERNAL_CA_DIR}"
  if [ ! -f "${INTERNAL_CA_KEY}" ] || [ ! -f "${INTERNAL_CA_CERT}" ]; then
    echo "[INFO] Generating internal CA certificate..."
    openssl req -x509 -newkey rsa:4096 -sha256 -nodes \
      -days "${INTERNAL_CA_DAYS}" \
      -subj "/CN=${INTERNAL_CA_CN}" \
      -keyout "${INTERNAL_CA_KEY}" \
      -out "${INTERNAL_CA_CERT}"
    chmod 600 "${INTERNAL_CA_KEY}"
  fi
}

generate_internal_server_cert_if_needed() {
  mkdir -p "${INTERNAL_CERT_DIR}"
  if [ ! -f "${INTERNAL_SERVER_KEY}" ] || [ ! -f "${INTERNAL_SERVER_FULLCHAIN}" ]; then
    echo "[INFO] Generating internal TLS server certificate for ${INTERNAL_CERT_CN}..."
    openssl req -newkey rsa:2048 -nodes \
      -subj "/CN=${INTERNAL_CERT_CN}" \
      -keyout "${INTERNAL_SERVER_KEY}" \
      -out "${INTERNAL_SERVER_CSR}"

    cat > "${INTERNAL_SERVER_EXT}" <<EOF
subjectAltName=DNS:${INTERNAL_CERT_CN},DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
keyUsage=digitalSignature,keyEncipherment
EOF

    openssl x509 -req \
      -in "${INTERNAL_SERVER_CSR}" \
      -CA "${INTERNAL_CA_CERT}" \
      -CAkey "${INTERNAL_CA_KEY}" \
      -CAcreateserial \
      -days "${INTERNAL_CERT_DAYS}" \
      -sha256 \
      -extfile "${INTERNAL_SERVER_EXT}" \
      -out "${INTERNAL_SERVER_CERT}"

    cat "${INTERNAL_SERVER_CERT}" "${INTERNAL_CA_CERT}" > "${INTERNAL_SERVER_FULLCHAIN}"
    chmod 600 "${INTERNAL_SERVER_KEY}"
    rm -f "${INTERNAL_SERVER_CSR}" "${INTERNAL_SERVER_EXT}"
  fi
}

if [ "${TLS_MODE}" = "internal" ]; then
  generate_internal_ca_if_needed
  generate_internal_server_cert_if_needed
  CERT_PATH="${INTERNAL_SERVER_FULLCHAIN}"
  KEY_PATH="${INTERNAL_SERVER_KEY}"
  echo "[INFO] TLS mode: internal"
elif [ "${TLS_MODE}" = "external" ]; then
  if [ ! -f "${EXTERNAL_CERT_PATH}" ] || [ ! -f "${EXTERNAL_KEY_PATH}" ]; then
    echo "[ERROR] TLS_MODE=external but cert/key files are missing."
    echo "[ERROR] Expected cert: ${EXTERNAL_CERT_PATH}"
    echo "[ERROR] Expected key : ${EXTERNAL_KEY_PATH}"
    exit 1
  fi
  CERT_PATH="${EXTERNAL_CERT_PATH}"
  KEY_PATH="${EXTERNAL_KEY_PATH}"
  echo "[INFO] TLS mode: external"
else
  echo "[ERROR] Unsupported TLS_MODE: ${TLS_MODE}"
  echo "[ERROR] Use one of: internal, external"
  exit 1
fi

export SERVER_NAME CERT_PATH KEY_PATH
envsubst '${SERVER_NAME} ${CERT_PATH} ${KEY_PATH}' \
  < /etc/nginx/templates/default.https.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
