FROM node:24.2.0-alpine

# Set the working directory inside the container at _build_ time
WORKDIR /app

# Install FFmpeg for server-side audio normalization (converts uploads to normalized WAV)
RUN apk add --no-cache ffmpeg

# Copy the package.json files so that we can do the install note this is done before everything else
# so that caching can take place and we don't reinstall everything every time
COPY package*.json ./

# Then copy the application files
COPY . .

# Then do the install
RUN npm install

# The following two commands are only used if the container is run independently.  If it is run via docker-compose
# then these are both overridden.  I am leaving them in here in case in the future we have a front end and back end
# team separately working on the project

# Port to expose (this would be in a dev environement)
EXPOSE 3000

# Start the application
CMD ["npm", "run", "dev"]