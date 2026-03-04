import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';


@Injectable({
  providedIn: 'root',
})
export class DataTransfer {
  constructor(private http: HttpClient) {}

  sendData(data: any) {
    const serverIp = localStorage.getItem('serverIp');
    if (!serverIp) {
      console.error('Server IP not set');
      return;
    }

    const url = `http://${serverIp}/barcode-template/scan`;

    console.log('Sending data to:', url);

    this.http.post(url, data).subscribe(
      (response) => {
        console.log('Data sent successfully:', response);
      },
      (error) => {
        console.error('Error sending data:', error);
      }
    );
  }
  
}
