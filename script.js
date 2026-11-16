const brandLogo = document.getElementById("brandLogo");

if (brandLogo) {
    brandLogo.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.hash = "top";
    });

    brandLogo.addEventListener("dblclick", (event) => {
        event.preventDefault();
        window.location.href = "employee information/verification.html";
    });
}
