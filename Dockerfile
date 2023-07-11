FROM node:18-alpine


WORKDIR /app

# Copying src files
COPY /src/ /app/src/
COPY /models/ /app/models/
COPY /genieacs-sim /app/
COPY /package*.json /app/


RUN chown -R node:node /app
USER node

# Building
RUN npm install

# Default env vars
ENV GENIEACS_SIM_DATA_MODEL device-H199Z
ENV GENIEACS_SIM_CWMP_URL http://genieacs:7547
ENV GENIEACS_SIM_SERIAL_NUMBER 0

CMD /app/genieacs-sim \
    --data-model $GENIEACS_SIM_DATA_MODEL \
    --acs-url $GENIEACS_SIM_CWMP_URL \
    --serial $GENIEACS_SIM_SERIAL_NUMBER \
    --processes 1
