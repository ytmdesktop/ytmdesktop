# Main Process
This folder is the main process code for the application. Some important terminology and how the application distincts systems is below.

## Integrations
An integration is an optional system and can be excluded from the application if it is not desired.

The lifecycle of an integration is a bit different from services as well since there is only AppBeforeReady and AppReady. AppReady is only emitted once the rest of the application and its services are ready.

## Services
A service are required systems for the application to function and must always be part of the final build.
