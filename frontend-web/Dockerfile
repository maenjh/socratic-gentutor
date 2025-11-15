# GenReact Frontend (static web) Dockerfile
FROM nginx:1.27-alpine

# Copy static assets into Nginx default web root
WORKDIR /usr/share/nginx/html
COPY index.html .
COPY static ./static

# Expose HTTP port
EXPOSE 80

# Run Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]

