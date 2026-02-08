module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}", "./lib/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        silver: {
          DEFAULT: "#C9C9C9",
          hover: "#BDBDBD",
          active: "#B0B0B0",
          text: "#1A1A1A",
          border: "#B5B5B5",
          disabled: "#E5E5E5"
        }
      }
    }
  },
  plugins: []
};
