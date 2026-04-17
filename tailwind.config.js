module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}", "./lib/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        silver: {
          DEFAULT: "#1F1F1F",
          hover: "#5A5A5A",
          active: "#111111",
          text: "#FAFAFA",
          border: "#1F1F1F",
          disabled: "#E5E5E5"
        }
      }
    }
  },
  plugins: []
};
