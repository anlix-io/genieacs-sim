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
ENV GENIEACS_SIM_DATA_MODEL device-C0B101-ZXHN%20H199A-ZTEYH86LCN10105-2023-03-28T154022233Z
ENV GENIEACS_SIM_CWMP_URL http://genieacs:7547
ENV GENIEACS_SIM_SERIAL_NUMBER 0

CMD /app/genieacs-sim \
    --data-model $GENIEACS_SIM_DATA_MODEL \
    --acs-url $GENIEACS_SIM_CWMP_URL \
    --serial $GENIEACS_SIM_SERIAL_NUMBER \
    --processes 1
