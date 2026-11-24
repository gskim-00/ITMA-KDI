FROM nginx:1.27-alpine

RUN apk add --no-cache openssl gettext

COPY infra/nginx/templates/default.https.conf.template /etc/nginx/templates/default.https.conf.template
COPY infra/nginx/scripts/start-nginx.sh /usr/local/bin/start-nginx.sh

RUN chmod +x /usr/local/bin/start-nginx.sh

CMD ["/usr/local/bin/start-nginx.sh"]
