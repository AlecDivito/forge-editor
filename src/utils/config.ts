import fs from "fs";
import path from "path";

// Function to load configuration values from a JSON file
export const loadConfig = (configFilePath = "./config.json") => {
  try {
    const absolutePath = path.resolve(configFilePath);
    const rawData = fs.readFileSync(absolutePath, "utf-8");
    const config = JSON.parse(rawData);
    return config;
  } catch (error) {
    console.error("Error reading configuration file:", error);
    throw new Error(
      "Failed to load configuration. Please ensure the config file exists and is valid JSON."
    );
  }
};
