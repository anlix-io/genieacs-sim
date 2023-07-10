# genieacs-sim

TR-069 client simulator for GenieACS.

To install:

    git clone https://github.com/zaidka/genieacs-sim.git
    cd genieacs-sim
    npm install

To use:

    ./genieacs-sim --help


There is a Dockerfile included. It instantiates a single instance and it has these environment variables to configure:

| Environment variable          | Required  | Default value                                                     | Description                                                           |
| -                             | -         | -                                                                 | -                                                                     |
| GENIEACS_SIM_DATA_MODEL       | No        | device-C0B101-ZXHN%20H199A-ZTEYH86LCN10105-2023-03-28T154022233Z  | This should be compatiple with one of the devices in `/models` folder |
| GENIEACS_SIM_CWMP_URL         | No        | http://genieacs:7547                                              | URL that this instance will reach as Genie CWMP                       |
| GENIEACS_SIM_SERIAL_NUMBER    | No        | 0                                                                 | Serial number of the instantiated CPE                                 |
